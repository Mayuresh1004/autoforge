import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  SandboxNetwork,
  SandboxOutput,
  SandboxRunOptions,
  SandboxRuntime,
  SandboxWorkspace,
} from '../domain/ports/sandbox';

const execFileAsync = promisify(execFile);

export type ContainerEngine = 'docker' | 'podman';
/** Underlying OCI runtime; `runsc` = gVisor (stronger isolation). */
export type ContainerRuntime = 'runc' | 'runsc';

export interface ContainerSandboxOptions {
  /** Container image; must bundle git + the analyzer/scanner CLIs. */
  readonly image: string;
  readonly engine?: ContainerEngine;
  readonly runtime?: ContainerRuntime;
  /** Non-root uid the container process runs as. */
  readonly uid?: number;
  readonly memory?: string;
  readonly cpus?: number;
  /** Where the workspace is mounted inside the container. */
  readonly mountPath?: string;
}

/**
 * Pure builder for a hardened `container run` command (Docker/Podman, runc or
 * gVisor `runsc`). Kept pure so it is fully unit-testable with no runtime.
 */
export function buildContainerArgs(options: {
  engine: ContainerEngine;
  image: string;
  workspaceHostPath: string;
  mountPath: string;
  argv: readonly string[];
  network: SandboxNetwork;
  runtime?: ContainerRuntime;
  env?: Readonly<Record<string, string>>;
  uid?: number;
  memory?: string;
  cpus?: number;
}): string[] {
  const { engine, image, workspaceHostPath, mountPath, argv, network } = options;

  const base: string[] = ['run', '--rm'];

  // Network: egress off by default; `bridge` only when the operation needs it.
  base.push('--network', network === 'net' ? 'bridge' : 'none');

  // Read-only rootfs; the only writable spaces are the workspace mount and a
  // small tmpfs. Capability drop + no-new-privileges prevents escalation.
  base.push('--read-only', '--tmpfs', '/tmp:rw,exec,nodev,nosuid');
  base.push('--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true');

  if (options.runtime === 'runsc') base.push('--runtime', 'runsc'); // gVisor
  if (typeof options.uid === 'number') base.push('--user', String(options.uid));
  if (options.memory) base.push('--memory', options.memory);
  if (options.cpus) base.push('--cpus', String(options.cpus));

  // Bind the workspace (the only host rw path) and set workdir inside it.
  base.push('--volume', `${workspaceHostPath}:${mountPath}`, '--workdir', mountPath);

  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      base.push('--env', `${key}=${value}`);
    }
  }

  base.push(image, ...argv);
  return base;
}

/**
 * Maps a host path under `hostRoot` to the container `mountPath`; paths outside
 * the root pass through unchanged. The sandbox owns this so every operation can
 * speak workspace-relative paths inside the container.
 */
export function mapPathToContainer(
  hostPath: string,
  hostRoot: string,
  mountPath: string
): string {
  const normalized = path.resolve(hostPath);
  const root = path.resolve(hostRoot);
  if (normalized === root) return mountPath;
  if (normalized.startsWith(root + path.sep)) {
    return mountPath + normalized.slice(root.length);
  }
  return normalized;
}

/**
 * Backend that runs every operation (clone, analyze, scan, future agents)
 * inside a throwaway container from a fixed image. The host↔container path
 * mapping is owned here. Overall: the repository working tree lives under a
 * single workspace dir which is bound at `mountPath`, so callers pass
 * workspace-relative paths/argv.
 */
export class ContainerSandboxRuntime implements SandboxRuntime {
  private readonly engine: ContainerEngine;
  private readonly image: string;
  private readonly runtime: ContainerRuntime;
  private readonly uid?: number;
  private readonly memory?: string;
  private readonly cpus?: number;
  private readonly mountPath: string;
  private readonly tmpRoot: string;
  private available: boolean | null = null;

  constructor(options: ContainerSandboxOptions) {
    this.engine = options.engine ?? 'docker';
    this.image = options.image;
    this.runtime = options.runtime ?? 'runc';
    this.uid = options.uid ?? 10001;
    this.memory = options.memory;
    this.cpus = options.cpus;
    this.mountPath = options.mountPath ?? '/workspace';
    this.tmpRoot = os.tmpdir();
  }

  async run(options: SandboxRunOptions): Promise<SandboxOutput> {
    if (!(await this.isAvailable())) {
      return { stdout: '', stderr: 'container runtime unavailable', exitCode: null, timedOut: false };
    }

    const env = buildEnv(options.envAllowlist, options.envOverrides);
    // The working directory is the single dir we bind into the container.
    const workspaceRoot = path.resolve(options.cwd);
    const argv = options.argv.map((arg) => mapPathToContainer(arg, workspaceRoot, this.mountPath));
    const args = buildContainerArgs({
      engine: this.engine,
      image: this.image,
      workspaceHostPath: workspaceRoot,
      mountPath: this.mountPath,
      argv,
      network: options.network,
      runtime: this.runtime,
      env,
      uid: this.uid,
      memory: this.memory,
      cpus: this.cpus,
    });

    try {
      const { stdout, stderr } = await execFileAsync(this.engine, args, {
        timeout: options.timeoutMs,
        maxBuffer: options.maxBufferBytes ?? 32 * 1024 * 1024,
      });
      return { stdout, stderr, exitCode: 0, timedOut: false };
    } catch (error) {
      const err = error as { code?: number | null; killed?: boolean; signal?: string; stdout?: string; stderr?: string };
      return {
        stdout: (err.stdout ?? '') as string,
        stderr: (err.stderr ?? '') as string,
        exitCode: err.killed === true && err.signal === 'SIGTERM' ? null : (err.code ?? null),
        timedOut: err.killed === true && err.signal === 'SIGTERM',
      };
    }
  }

  async createWorkspace(label = 'sandbox'): Promise<SandboxWorkspace> {
    const dir = await fs.mkdtemp(path.join(this.tmpRoot, `amass-${label}-`));
    return {
      dir,
      dispose: async () => {
        await fs.rm(dir, { recursive: true, force: true });
      },
    };
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      await execFileAsync(this.engine, ['version', '--format', '{{.Server.Version}}'], {
        timeout: 4_000,
      });
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }
}

function buildEnv(
  allowlist: readonly string[] | undefined,
  overrides?: Readonly<Record<string, string>>
): Record<string, string> | undefined {
  const keys = allowlist ?? ['PATH', 'HOME', 'TMPDIR', 'LANG'];
  const env: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) env[key] = value;
  }
  return Object.keys(env).length > 0 ? env : undefined;
}