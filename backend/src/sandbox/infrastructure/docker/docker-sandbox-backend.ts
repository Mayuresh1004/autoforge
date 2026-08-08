import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ExecRequest,
  ExecResult,
  SandboxContainerInfo,
  SandboxSpec,
} from '../../domain/models/sandbox';
import {
  SandboxImageBuildError,
} from '../../domain/errors/sandbox-runtime.errors';
import type {
  BuildImageRequest,
  BuildImageResult,
  SandboxBackend,
} from '../../domain/ports/sandbox-manager';
import {
  buildCreateCommand,
  buildImageCommand,
  defaultDockerRunner,
  type DockerRunner,
} from './docker-cli';

const MOUNT = '/workspace';

/**
 * The only Docker-touching implementation. Sandboxes are long-lived named
 * containers (kept alive with `tail`) that the manager exec/logs/restarts,
 * and destroys. Everything here is argv-only and delegated to `docker`, never
 * to a shell. `create` returns the generated container/network names.
 *
 * Phase 6 additions: `buildImage` / `removeImage` / `inspect` for runtime
 * sandboxes, plus container-level hardening knobs (no host mount, explicit
 * env allowlist, PID limit, image-default CMD, localhost-only dynamic port).
 */
export class DockerSandboxBackend implements SandboxBackend {
  private readonly runner: DockerRunner;
  private readonly ctx = new Map<
    string,
    { scanId: string; networkId?: string; hostPort?: number }
  >();

  constructor(runner: DockerRunner = defaultDockerRunner) {
    this.runner = runner;
  }

  async create(spec: SandboxSpec): Promise<{
    containerId: string;
    networkId?: string;
    ipAddress?: string;
    hostPort?: number;
  }> {
    const name = `amass_${spec.scanId}_${randomUUID().slice(0, 8)}`;
    const networkId =
      spec.network.egress === 'internal' ? `amass-net-${spec.scanId}` : undefined;

    if (networkId) {
      await this.ensureNetwork(networkId, spec.scanId);
    }

    const args = buildCreateCommand(spec, name, MOUNT);
    const out = await this.runner(args, 120_000);
    if (out.exitCode !== 0) {
      throw new Error(`docker create failed: ${out.stderr.trim()}`);
    }

    const hostPort = spec.hostPublishLocalhost
      ? await this.readPublishedPort(name)
      : undefined;

    this.ctx.set(name, { scanId: spec.scanId, networkId, hostPort });
    return { containerId: name, networkId, hostPort };
  }

  async start(id: string): Promise<void> {
    await this.mustRun(['start', id], `start=${id}`);
  }

  async isReady(id: string): Promise<boolean> {
    const out = await this.runner(['inspect', '-f', '{{.State.Running}}', id]);
    return out.exitCode === 0 && out.stdout.trim() === 'true';
  }

  async execute(id: string, request: ExecRequest): Promise<ExecResult> {
    const args = ['exec'].concat(
      request.cwd ? ['--workdir', this.toMountPath(request.cwd)] : [],
      ...this.envArgs(request),
      id,
      ...request.argv
    );
    const out = await this.runner(args, request.timeoutMs);
    return {
      stdout: out.stdout,
      stderr: out.stderr,
      exitCode: out.exitCode,
      timedOut: out.timedOut,
    };
  }

  async copyFile(id: string, sourceHostPath: string, destPath: string): Promise<void> {
    await this.mustRun(['cp', sourceHostPath, `${id}:${this.toMountPath(destPath)}`], `copy=${id}`);
  }

  async writeFile(id: string, destPath: string, content: string): Promise<void> {
    const tmp = path.join(tmpdir(), `amass-patch-${randomUUID()}`);
    await fs.writeFile(tmp, content, 'utf8');
    try {
      await this.mustRun(['cp', tmp, `${id}:${this.toMountPath(destPath)}`], `patch=${id}`);
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  async restart(id: string): Promise<void> {
    await this.mustRun(['restart', id], `restart=${id}`);
  }

  async *logs(id: string): AsyncIterable<string> {
    const out = await this.runner(['logs', '--tail', '500', id]);
    if (out.stdout) {
      for (const line of out.stdout.split('\n')) if (line) yield line;
    }
  }

  async destroy(id: string): Promise<void> {
    const ctx = this.ctx.get(id);
    await this.runner(['rm', '-f', id]);
    if (ctx?.networkId) {
      await this.runner(['network', 'rm', ctx.networkId]);
    }
    this.ctx.delete(id);
  }

  async buildImage(request: BuildImageRequest): Promise<BuildImageResult> {
    const args = buildImageCommand({
      contextPath: request.contextPath,
      dockerfilePath: request.dockerfilePath,
      imageName: request.imageName,
      labels: request.labels,
    });
    const out = await this.runner(args, request.timeoutMs ?? 300_000);
    if (out.exitCode !== 0) {
      const tail = out.stderr.trim().split('\n').slice(-30).join('\n');
      throw new SandboxImageBuildError('docker build failed', tail);
    }
    // `-q` prints the image id on stdout; fall back to the name.
    return { imageId: out.stdout.trim() || request.imageName, imageName: request.imageName };
  }

  async removeImage(imageIdOrName: string): Promise<void> {
    const out = await this.runner(['rmi', '-f', imageIdOrName]);
    if (out.exitCode !== 0 && !isNotFound(out.stderr)) {
      throw new Error(`docker rmi failed: ${out.stderr.trim()}`);
    }
  }

  async inspect(containerId: string): Promise<SandboxContainerInfo | null> {
    const out = await this.runner([
      'inspect',
      '-f',
      '{{.State.Running}}|{{.State.Status}}|{{range $k, $v := .NetworkSettings.Networks}}{{$v.IPAddress}} {{end}}',
      containerId,
    ]);
    if (out.exitCode !== 0) return null;
    const [running, status, ips] = out.stdout.trim().split('|');
    const ipAddress = (ips ?? '').split(/\s+/).find((ip) => ip.length > 0);
    return {
      running: running === 'true',
      status: status || 'unknown',
      ipAddress: ipAddress ?? undefined,
    };
  }

  async sweep(): Promise<number> {
    const out = await this.runner(['ps', '-aq', '--filter', 'label=amass.manager=1']);
    const ids = out.stdout.split('\n').filter(Boolean);
    for (const id of ids) await this.runner(['rm', '-f', id]);
    const nets = await this.runner(['network', 'ls', '-q', '--filter', 'label=amass.manager=1']);
    for (const net of nets.stdout.split('\n').filter(Boolean)) {
      await this.runner(['network', 'rm', net]);
    }
    const imgs = await this.runner(['images', '-q', '--filter', 'label=amass.manager=1']);
    for (const img of imgs.stdout.split('\n').filter(Boolean)) {
      await this.runner(['rmi', '-f', img]);
    }
    return ids.length;
  }

  // -- internals -------------------------------------------------------------

  private async ensureNetwork(networkId: string, scanId: string): Promise<void> {
    const existing = await this.runner(['network', 'inspect', networkId]);
    if (existing.exitCode === 0) return; // idempotent: sibling sandboxes share the scan net
    await this.runner([
      'network', 'create', '--label', 'amass.manager=1', '--label', `amass.scan=${scanId}`,
      '--internal', networkId,
    ]);
  }

  private async readPublishedPort(name: string): Promise<number | undefined> {
    const out = await this.runner(['port', name]);
    const match = out.stdout.match(/127\.0\.0\.1:(\d+)/);
    return match ? Number(match[1]) : undefined;
  }

  private async mustRun(args: string[], label: string): Promise<void> {
    const out = await this.runner(args);
    if (out.exitCode !== 0) throw new Error(`docker ${label} failed: ${out.stderr.trim()}`);
  }

  private toMountPath(containerPath: string): string {
    // Relative paths are resolved under the mount; absolute paths are used as-is.
    if (containerPath.startsWith('/')) return containerPath;
    return `${MOUNT}/${containerPath}`;
  }

  private envArgs(request: ExecRequest): string[] {
    const env: string[] = [];
    for (const key of request.envAllowlist ?? ['PATH', 'HOME']) {
      const v = process.env[key];
      if (v !== undefined) env.push('--env', `${key}=${v}`);
    }
    if (request.envOverrides) {
      for (const [k, v] of Object.entries(request.envOverrides)) env.push('--env', `${k}=${v}`);
    }
    return env;
  }
}

/** Docker's 'not found' exits are expected during idempotent cleanup. */
function isNotFound(stderr: string): boolean {
  return /No such (image|container|network)/.test(stderr);
}