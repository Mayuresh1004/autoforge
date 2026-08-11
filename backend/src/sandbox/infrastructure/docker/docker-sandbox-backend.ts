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
  NetworkHealthProbeRequest,
  SandboxBackend,
} from '../../domain/ports/sandbox-manager';
import type { HealthProbeResult } from '../../domain/value-objects/runtime-config';
import {
  buildCreateCommand,
  buildImageCommand,
  buildProbeCommand,
  defaultDockerRunner,
  type DockerRunner,
} from './docker-cli';
import { logger } from '../../../config/logger';

const MOUNT = '/workspace';
/**
 * Synthetic `repositoryPath` value analysis sandboxes pass to signal "the
 * backend materializes its own workspace". The Docker backend interprets it
 * as a request for a backend-owned ephemeral HOST workspace: a unique
 * directory under `workspaceRoot` is provisioned (owned compatibly with the
 * image's non-root user), bind-mounted at `/workspace`, and returned as the
 * HOST path in `workspacePath` so the orchestrator can analyze the cloned
 * tree from the host side.
 */
const SYNTHETIC_REPO_PATH = 'in-sandbox';
/** Fallback image used to empty crash-orphaned workspaces during sweep. */
const DEFAULT_ANALYSIS_IMAGE = 'amass/analysis:local';
/** Probe image fallback when no config override is provided. */
const DEFAULT_PROBE_IMAGE = 'node:20-alpine';

export interface DockerSandboxBackendOptions {
  /**
   * Root that holds one throwaway workspace dir per analysis sandbox. Must
   * be a real host path (the Docker daemon resolves bind-mount sources on
   * the host). Defaults to the same AMASS temp root the process backend
   * uses. When the backend itself runs inside Docker, point this at a host
   * directory mounted into the backend container.
   */
  readonly workspaceRoot?: string;
}

interface DockerSandboxContext {
  readonly scanId: string;
  readonly networkId?: string;
  readonly hostPort?: number;
  /** Image the sandbox runs; needed for root-helper workspace cleanup. */
  readonly image: string;
  /** Host path of the backend-provisioned workspace (analysis sandboxes). */
  readonly hostWorkspace?: string;
}

/**
 * The only Docker-touching implementation. Sandboxes are long-lived named
 * containers (kept alive with `tail`) that the manager exec/logs/restarts,
 * and destroys. Everything here is argv-only and delegated to `docker`, never
 * to a shell. `create` returns the generated container/network names.
 *
 * ANALYSIS sandboxes: when `repositoryPath` is the synthetic `'in-sandbox'`
 * marker, the backend provisions a REAL ephemeral host workspace (unique
 * directory under `workspaceRoot`), sets its ownership so the image's
 * non-root user can write to it, bind-mounts it at `/workspace`, and returns
 * the HOST path in `workspacePath`. `destroy` removes the container, the
 * network AND the temporary workspace, idempotently. Absolute host
 * `repositoryPath` values keep the original behavior (mounted verbatim).
 *
 * RUNTIME sandboxes (`mountRepository: false`) never touch the host
 * filesystem: the image carries the payload and no volume is bound.
 *
 * Phase 6 additions: `buildImage` / `removeImage` / `inspect` for runtime
 * sandboxes, plus container-level hardening knobs (no host mount, explicit
 * env allowlist, PID limit, image-default CMD, localhost-only dynamic port).
 */
export class DockerSandboxBackend implements SandboxBackend {
  private readonly runner: DockerRunner;
  private readonly workspaceRoot: string;
  private readonly ctx = new Map<string, DockerSandboxContext>();
  /** host workspace path -> owning container metadata (cleanup can find both sides). */
  private readonly hostWorkspaces = new Map<string, { containerId: string; image: string }>();
  /** image -> resolved non-root uid/gid the sandbox container runs as. */
  private readonly imageUserCache = new Map<string, { uid: number; gid: number }>();

  constructor(
    runner: DockerRunner = defaultDockerRunner,
    options: DockerSandboxBackendOptions = {}
  ) {
    this.runner = runner;
    this.workspaceRoot = options.workspaceRoot ?? path.join(tmpdir(), 'amass-workspaces');
  }

  async create(spec: SandboxSpec): Promise<{
    containerId: string;
    networkId?: string;
    workspacePath?: string;
    ipAddress?: string;
    hostPort?: number;
  }> {
    const name = `amass_${spec.scanId}_${randomUUID().slice(0, 8)}`;
    const networkId =
      spec.network.egress === 'internal' ? `amass-net-${spec.scanId}` : undefined;

    if (networkId) {
      await this.ensureNetwork(networkId, spec.scanId);
    }

    // Analysis sandboxes request a backend-owned ephemeral workspace with the
    // synthetic marker. Provision a real host dir and mount THAT, so the
    // non-root container user gets a writable `/workspace` and the
    // orchestrator gets a host-visible path for analyze/scan.
    let hostWorkspace: string | undefined;
    let effectiveSpec = spec;
    if (spec.mountRepository !== false && spec.repositoryPath === SYNTHETIC_REPO_PATH) {
      hostWorkspace = await this.provisionWorkspace(spec.image, name);
      effectiveSpec = { ...spec, repositoryPath: hostWorkspace };
    }

    const args = buildCreateCommand(effectiveSpec, name, MOUNT);
    const out = await this.runner(args, 120_000);
    if (out.exitCode !== 0) {
      if (hostWorkspace) {
        await fs.rm(hostWorkspace, { recursive: true, force: true }).catch(() => undefined);
      }
      throw new Error(`docker create failed: ${out.stderr.trim()}`);
    }

    const hostPort = spec.hostPublishLocalhost
      ? await this.readPublishedPort(name)
      : undefined;

    this.ctx.set(name, { scanId: spec.scanId, networkId, hostPort, image: spec.image, hostWorkspace });
    if (hostWorkspace) {
      this.hostWorkspaces.set(hostWorkspace, { containerId: name, image: spec.image });
    }
    return {
      containerId: name,
      networkId,
      // Analysis sandboxes with a backend-owned workspace expose the REAL
      // host path; absolute-host-path sandboxes keep the original behavior.
      workspacePath: hostWorkspace ?? (spec.mountRepository !== false ? MOUNT : undefined),
      hostPort,
    };
  }

  async start(id: string): Promise<void> {
    await this.mustRun(['start', id], `start=${id}`);
  }

  async isReady(id: string): Promise<boolean> {
    const out = await this.runner(['inspect', '-f', '{{.State.Running}}', id]);
    return out.exitCode === 0 && out.stdout.trim() === 'true';
  }

  async execute(id: string, request: ExecRequest): Promise<ExecResult> {
    const ctx = this.ctx.get(id);
    const cwd = request.cwd ? this.toMountPath(request.cwd, ctx?.hostWorkspace) : undefined;
    const args = ['exec'].concat(
      cwd ? ['--workdir', cwd] : [],
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
    if (ctx?.hostWorkspace) {
      await this.removeWorkspace(ctx.hostWorkspace, ctx.image).catch(() => undefined);
      this.hostWorkspaces.delete(ctx.hostWorkspace);
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

  /**
   * App-liveness probe executed from INSIDE the sandbox network: a hardened
   * throwaway probe container is attached to the sandbox's own `--internal`
   * network (the only place the target's internal IP is routable — the host
   * and unrelated containers are deliberately excluded by Docker's internal
   * network semantics). Runs `node -e` with the same TCP+HTTP semantics as
   * the host-side prober; `--rm` + the `amass.manager=1` label guarantee the
   * probe container never leaks (sweep reclaims crash leftovers).
   */
  async probeNetworkHealth(request: NetworkHealthProbeRequest): Promise<HealthProbeResult> {
    const args = buildProbeCommand({
      image: request.image ?? DEFAULT_PROBE_IMAGE,
      networkId: request.networkId,
      host: request.host,
      port: request.port,
      path: request.path,
      timeoutMs: request.timeoutMs,
    });
    const started = Date.now();
    // Bounded: the probe script self-limits, and the docker call is capped too
    // (script timeout + a margin for container start/stop).
    const out = await this.runner(args, request.timeoutMs + 15_000);
    const latencyMs = Date.now() - started;
    if (out.timedOut) {
      return {
        reachable: false,
        latencyMs,
        detail: `probe container timed out (${request.timeoutMs}ms)`,
      };
    }
    const line = out.stdout.split('\n').map((s) => s.trim()).find((s) => s.length > 0) ?? '';
    if (line.startsWith('HEALTH_OK')) {
      const statusCode = Number(line.split(/\s+/)[1]);
      return {
        reachable: true,
        latencyMs,
        statusCode: Number.isInteger(statusCode) ? statusCode : undefined,
      };
    }
    if (line.startsWith('HEALTH_ERR')) {
      const detail = line.slice('HEALTH_ERR'.length).trim();
      return { reachable: false, latencyMs, detail: detail || 'application did not answer' };
    }
    const stderrTail = out.stderr.trim().split('\n').slice(-3).join(' ');
    return {
      reachable: false,
      latencyMs,
      detail: `probe container failed: ${stderrTail || out.stdout.trim().slice(0, 200) || 'unknown error'}`,
    };
  }

  async sweep(): Promise<number> {
    const out = await this.runner(['ps', '-aq', '--filter', 'label=amass.manager=1']);
    const ids = out.stdout.split('\n').filter(Boolean);
    for (const id of ids) await this.runner(['rm', '-f', id]);

    // Containers are gone: drop every backend-provisioned workspace, plus any
    // crash-orphaned workspace dirs under this backend's root (crash orphans
    // are not in memory, but they share the `amass_` naming convention).
    for (const [ws, meta] of [...this.hostWorkspaces]) {
      await this.removeWorkspace(ws, meta.image).catch(() => undefined);
      this.hostWorkspaces.delete(ws);
    }
    const entries = await fs.readdir(this.workspaceRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('amass_')) {
        await this.removeWorkspace(path.join(this.workspaceRoot, entry.name), DEFAULT_ANALYSIS_IMAGE)
          .catch(() => undefined);
      }
    }

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

  /**
   * Map an exec/copy target to the CONTAINER path. The orchestrator hands the
   * backend-provisioned HOST workspace path as the workdir; translate it back
   * into the container mount so `docker exec --workdir` stays valid inside the
   * sandbox. Absolute container paths and relative paths are handled as before.
   */
  private toMountPath(containerOrHostPath: string, hostWorkspace?: string): string {
    if (
      hostWorkspace &&
      (containerOrHostPath === hostWorkspace ||
        containerOrHostPath.startsWith(hostWorkspace + path.sep))
    ) {
      return MOUNT + containerOrHostPath.slice(hostWorkspace.length);
    }
    if (containerOrHostPath.startsWith('/')) return containerOrHostPath;
    return `${MOUNT}/${containerOrHostPath}`;
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

  /** Provision a unique, image-user-compatible host workspace for one sandbox. */
  private async provisionWorkspace(image: string, name: string): Promise<string> {
    await fs.mkdir(this.workspaceRoot, { recursive: true });
    const dir = path.join(this.workspaceRoot, name);
    await fs.mkdir(dir, { recursive: true });
    const { uid, gid } = await this.resolveImageUser(image);
    await this.makeWritableBy(dir, uid, gid, image);
    return dir;
  }

  /**
   * Resolve the numeric uid/gid the sandbox container will run as, from the
   * image itself: run the image with its OWN default USER (exactly what the
   * sandbox container does — no `--user` override) and read `id -u` / `id -g`.
   * Deterministic, never couples the container uid to a host uid, and works
   * for both name and numeric `USER` declarations. Cached per image.
   */
  private async resolveImageUser(image: string): Promise<{ uid: number; gid: number }> {
    const cached = this.imageUserCache.get(image);
    if (cached) return cached;
    const out = await this.runner(
      ['run', '--rm', '--entrypoint', 'sh', image, '-c', 'id -u; id -g'],
      60_000
    );
    if (out.exitCode !== 0) {
      throw new Error(
        `cannot resolve sandbox user for image ${image} (does it have /bin/sh?): ${out.stderr.trim()}`
      );
    }
    const [uid, gid] = out.stdout.trim().split('\n').map((line) => Number(line.trim()));
    if (!Number.isInteger(uid) || !Number.isInteger(gid) || gid < 0 || uid < 0) {
      throw new Error(`cannot parse uid/gid for image ${image} (got '${out.stdout.trim()}')`);
    }
    const resolved = { uid, gid };
    this.imageUserCache.set(image, resolved);
    return resolved;
  }

  /**
   * Remove a backend-provisioned host workspace. The host process owns the
   * top directory, but files git-cloned INSIDE the container belong to the
   * container's non-root uid, which the host cannot unlink (EACCES). When the
   * plain recursive remove fails that way, the workspace is emptied through a
   * throwaway root helper container built from the SAME image, then the host
   * removes the (now empty, host-owned) top directory. Idempotent: a missing
   * directory is a no-op, and cleanup never throws to the caller.
   */
  private async removeWorkspace(dir: string, image: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EACCES' && code !== 'EPERM') throw error;
    }
    // Host cannot unlink container-owned files: empty the mount as root.
    // `find -delete` clears every child (incl. dotfiles) without touching the
    // bind-mount point itself, so it succeeds where `rm -rf /ws` would
    // spuriously fail with 'Resource busy'.
    const out = await this.runner(
      [
        'run', '--rm', '--user', '0:0',
        '--volume', `${dir}:/ws`,
        '--entrypoint', 'sh', image,
        '-c', 'find /ws -mindepth 1 -delete',
      ],
      60_000
    );
    if (out.exitCode !== 0) {
      logger.warn({ dir, image, stderr: out.stderr.trim() }, 'sandbox.workspace.empty-helper failed; continuing');
    }
    // The helper emptied the bind mount; the top dir itself is host-owned.
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }

  /** Give the bind-mounted host workspace ownership compatible with the
   * container's non-root user WITHOUT running the container as root or
   * chmod-ing 777:
   *   - owner  = the host backend process (it must read the cloned tree for
   *     analyze/scan on the host side),
   *   - group  = the image user's group (the container user writes through
   *     group permissions),
   *   - mode   = 0770 (no world access).
   * When the backend cannot chown itself (non-root host), ownership is set by
   * a throwaway root helper container built from the SAME image, so the
   * workspace is only ever owned/accessed in terms of the image's own user.
   */
  private async makeWritableBy(
    dir: string,
    uid: number,
    gid: number,
    image: string
  ): Promise<void> {
    const myUid = process.getuid?.();
    if (myUid === uid) {
      // Backend runs as the sandbox user: dir is already owner-writable.
      await fs.chmod(dir, 0o770).catch(() => undefined);
      return;
    }
    if (myUid === 0) {
      // Root backend: chown directly; the container user matches via owner.
      await fs.chown(dir, uid, gid);
      await fs.chmod(dir, 0o770);
      return;
    }
    const ownerUid = myUid ?? uid;
    const out = await this.runner(
      [
        'run', '--rm', '--user', '0:0',
        '--volume', `${dir}:/ws`,
        '--entrypoint', 'sh', image,
        '-c', `chown ${ownerUid}:${gid} /ws && chmod 770 /ws`,
      ],
      60_000
    );
    if (out.exitCode !== 0) {
      throw new Error(
        `failed to set workspace ownership for ${image}: ${out.stderr.trim()}`
      );
    }
  }
}

/** Docker's 'not found' exits are expected during idempotent cleanup. */
function isNotFound(stderr: string): boolean {
  return /No such (image|container|network)/.test(stderr);
}
