import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ExecRequest, ExecResult, SandboxSpec } from '../domain/models/sandbox';
import type { SandboxBackend } from '../domain/ports/sandbox-manager';
import { ProcessSandboxRuntime } from './process-sandbox';

export interface ProcessSandboxBackendOptions {
  /** Root directory that holds one throwaway workspace dir per sandbox. */
  workspaceRoot: string;
  maxBufferBytes?: number;
  runtime?: ProcessSandboxRuntime;
}

/**
 * A real, no-Docker `SandboxBackend`. Each sandbox is a throwaway directory
 * under `workspaceRoot`; every command runs via `ProcessSandboxRuntime`
 * (argv-only, hard timeout, bounded output, `unshare --net` isolation,
 * non-root, allowlisted env). This keeps the Sandbox Manager as the single
 * gatekeeper even for local/headless runs, so the whole pipeline (clone →
 * analyze → scan) is exercised through the manager without a container host.
 */
export class ProcessSandboxBackend implements SandboxBackend {
  private readonly workspaceRoot: string;
  private readonly maxBufferBytes: number;
  private readonly runtime: ProcessSandboxRuntime;
  private readonly dirs = new Map<string, string>(); // backendId -> workspace dir
  private readonly recentLogs = new Map<string, string[]>(); // backendId -> ring buffer

  constructor(options: ProcessSandboxBackendOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.maxBufferBytes = options.maxBufferBytes ?? 32 * 1024 * 1024;
    this.runtime = options.runtime ?? new ProcessSandboxRuntime();
  }

  async create(spec: SandboxSpec): Promise<{ containerId: string; workspacePath: string }> {
    await fs.mkdir(this.workspaceRoot, { recursive: true });
    const backendId = `psbx_${randomUUID().slice(0, 12)}`;
    const dir = path.join(this.workspaceRoot, backendId);
    await fs.mkdir(dir, { recursive: true });
    this.dirs.set(backendId, dir);
    this.recentLogs.set(backendId, []);
    return { containerId: backendId, workspacePath: dir };
  }

  async start(_id: string): Promise<void> {
    return undefined; // workspace exists already; nothing to start
  }

  async isReady(id: string): Promise<boolean> {
    const dir = this.dirs.get(id);
    if (!dir) return false;
    try {
      await fs.access(dir);
      return true;
    } catch {
      return false;
    }
  }

  async execute(id: string, request: ExecRequest): Promise<ExecResult> {
    const dir = this.dirs.get(id) ?? path.join(this.workspaceRoot, id);
    const output = await this.runtime.run({
      argv: request.argv,
      cwd: request.cwd ?? dir,
      timeoutMs: request.timeoutMs,
      maxBufferBytes: this.maxBufferBytes,
      envAllowlist: request.envAllowlist,
      envOverrides: request.envOverrides,
      network: request.network === 'egress' ? 'net' : 'none',
    });
    this.pushLogs(id, output.stdout, output.stderr);
    return {
      stdout: output.stdout,
      stderr: output.stderr,
      exitCode: output.exitCode,
      timedOut: output.timedOut,
    };
  }

  async copyFile(id: string, sourceHostPath: string, destPath: string): Promise<void> {
    const dir = this.requireDir(id);
    const dest = this.resolveWithin(dir, destPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(sourceHostPath, dest);
  }

  async writeFile(id: string, destPath: string, content: string): Promise<void> {
    const dir = this.requireDir(id);
    const dest = this.resolveWithin(dir, destPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content, 'utf8');
  }

  async restart(_id: string): Promise<void> {
    return undefined; // no long-lived process to restart
  }

  async *logs(id: string): AsyncIterable<string> {
    for (const line of this.recentLogs.get(id) ?? []) yield line;
  }

  async destroy(id: string): Promise<void> {
    const dir = this.dirs.get(id);
    this.dirs.delete(id);
    this.recentLogs.delete(id);
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  async sweep(): Promise<number> {
    await fs.mkdir(this.workspaceRoot, { recursive: true }).catch(() => undefined);
    let swept = 0;
    const entries = await fs.readdir(this.workspaceRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() && !this.dirs.has(entry.name)) {
        await fs.rm(path.join(this.workspaceRoot, entry.name), { recursive: true, force: true }).catch(() => undefined);
        swept += 1;
      }
    }
    return swept;
  }

  // -- internals -------------------------------------------------------------

  private requireDir(id: string): string {
    const dir = this.dirs.get(id);
    if (!dir) throw new Error(`process sandbox ${id} not found`);
    return dir;
  }

  /** Keep copied/written paths inside this sandbox's workspace. */
  private resolveWithin(dir: string, destPath: string): string {
    const base = path.normalize(path.join(dir, '.'));
    const resolved = path.normalize(path.join(dir, destPath.startsWith('/') ? destPath.slice(1) : destPath));
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
      throw new Error(`path '${destPath}' escapes sandbox workspace`);
    }
    return resolved;
  }

  private pushLogs(id: string, ...chunks: readonly string[]): void {
    const lines = this.recentLogs.get(id) ?? [];
    for (const chunk of chunks) {
      for (const line of chunk.split('\n')) if (line) lines.push(line);
    }
    if (lines.length > 400) lines.splice(0, lines.length - 400);
    this.recentLogs.set(id, lines);
  }
}