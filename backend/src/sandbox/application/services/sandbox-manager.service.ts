import { randomUUID } from 'node:crypto';
import { logger } from '../../../config/logger';
import type {
  ExecRequest,
  ExecResult,
  Sandbox,
  SandboxContainerInfo,
  SandboxPatch,
  SandboxSpec,
  SandboxStatus,
} from '../../domain/models/sandbox';
import type {
  BuildImageRequest,
  BuildImageResult,
  CreateSandboxInput,
  NetworkHealthProbeRequest,
  SandboxBackend,
  SandboxHealth,
  SandboxManager,
  SandboxManagerOptions,
  ToolNetworkExecRequest,
} from '../../domain/ports/sandbox-manager';
import type { HealthProbeResult } from '../../domain/value-objects/runtime-config';

/**
 * Orchestrates the full sandbox lifecycle. This is the ONLY surface that
 * phases interact with; Docker knowledge lives behind the injected backend.
 *
 * Guarantees:
 * - every sandbox is unique and scan-scoped (no container-name collisions),
 * - every operation is bounded by a timeout,
 * - `destroy()` is idempotent and best-effort (cleanup even if it throws),
 * - the reaper (`sweepOrphans`) reclaims resources from crashed processes,
 * - analysis sandboxes default to no egress; explicit egress is honored only
 *   through an allowlist (the clone step), and a per-call `network` override
 *   can never be more permissive than the sandbox policy.
 *
 * Internal id note: phases address sandboxes by the manager-generated
 * `id` (`sbx_<scanId>_<uuid>`); the backend keys by its own `containerId`.
 * This class resolves that mapping on every backend call.
 */
export class SandboxManagerService implements SandboxManager {
  private readonly backend;
  private readonly store;
  private readonly defaultExecTimeoutMs: number;
  private readonly createTimeoutMs: number;

  constructor(options: SandboxManagerOptions) {
    this.backend = options.backend;
    this.store = options.store;
    this.defaultExecTimeoutMs = options.defaultExecTimeoutMs ?? 60_000;
    this.createTimeoutMs = options.createTimeoutMs ?? 120_000;
  }

  async createSandbox(input: CreateSandboxInput): Promise<Sandbox> {
    const id = this.sandboxId(input.scanId);
    const sandbox: Sandbox = {
      id,
      scanId: input.scanId,
      type: input.type,
      status: 'pending',
      image: input.image,
      repositoryPath: input.repositoryPath,
      network: {
        egress: this.networkEgress(input.type, input.egress),
        allowlist: input.egressAllowlist ?? [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(input.mountRepository === undefined ? {} : { mountRepository: input.mountRepository }),
      ...(input.env ? { env: input.env } : {}),
      ...(input.pidsLimit ? { pidsLimit: input.pidsLimit } : {}),
      ...(input.appCommand !== undefined ? { appCommand: input.appCommand } : {}),
      ...(input.hostPublishLocalhost ? { hostPublishLocalhost: input.hostPublishLocalhost } : {}),
    };
    await this.store.save(sandbox);

    try {
      await this.transition(id, 'creating');
      const spec: SandboxSpec = { ...sandbox };
      const { containerId, networkId, workspacePath, ipAddress, hostPort } = await this.withTimeout(
        this.backend.create(spec),
        this.createTimeoutMs,
        `create sandbox ${id}`
      );
      const created = {
        ...(await this.require(id)),
        containerId,
        networkId,
        workspacePath,
        ipAddress,
        exposedPort: hostPort ?? sandbox.exposedPort,
      };
      await this.store.save(created);

      await this.transition(id, 'starting');
      await this.withTimeout(this.backend.start(this.containerId(created, id)), this.createTimeoutMs, `start sandbox ${id}`);

      return await this.require(id);
    } catch (error) {
      logger.error({ id, error }, 'sandbox.create failed');
      await this.destroy(id).catch(() => undefined);
      throw error;
    }
  }

  async waitUntilReady(id: string, timeoutMs = this.createTimeoutMs): Promise<Sandbox> {
    const deadline = Date.now() + timeoutMs;
    const sandbox = await this.require(id);
    const backendId = this.containerId(sandbox, id);
    while (Date.now() < deadline) {
      if (await this.backend.isReady(backendId)) {
        return await this.transition(id, 'ready');
      }
      await sleep(250);
    }
    throw new Error(`sandbox ${id} did not become ready within ${timeoutMs}ms`);
  }

  async getSandbox(id: string): Promise<Sandbox | null> {
    return this.store.get(id).catch(() => null);
  }

  async healthCheck(id: string, timeoutMs = this.createTimeoutMs): Promise<SandboxHealth> {
    const sandbox = await this.store.get(id).catch(() => null);
    if (!sandbox) return { ok: false, status: 'pending', reason: 'sandbox not found' };
    if (sandbox.status === 'destroyed' || sandbox.status === 'failed') {
      return { ok: false, status: sandbox.status, reason: `sandbox in terminal state '${sandbox.status}'` };
    }
    try {
      const backendId = this.containerId(sandbox, id);
      const ready = await this.withTimeout(this.backend.isReady(backendId), timeoutMs, `health-check ${id}`);
      return { ok: ready, status: ready ? 'ready' : sandbox.status, reason: ready ? undefined : 'not ready' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, status: sandbox.status, reason: message };
    }
  }

  async execute(id: string, request: ExecRequest): Promise<ExecResult> {
    const sandbox = await this.require(id);
    const backendId = this.containerId(sandbox, id);
    const requestedEgress = request.network ?? sandbox.network.egress;
    this.assertEgressAllowed(sandbox.network.egress, requestedEgress, id);

    const timeoutMs = request.timeoutMs ?? this.defaultExecTimeoutMs;
    await this.transition(id, 'executing');
    try {
      return await this.backend.execute(
        backendId,
        { ...request, network: requestedEgress, timeoutMs, envAllowlist: request.envAllowlist ?? ['PATH', 'HOME'] }
      );
    } finally {
      await this.transition(id, 'running').catch(() => undefined);
    }
  }

  async copyFile(id: string, sourceHostPath: string, destPath: string): Promise<void> {
    const sandbox = await this.require(id);
    await this.backend.copyFile(this.containerId(sandbox, id), sourceHostPath, destPath);
    logger.info({ id, sourceHostPath, destPath }, 'sandbox.copyFile');
  }

  async applyPatch(id: string, patches: readonly SandboxPatch[]): Promise<Sandbox> {
    const sandbox = await this.require(id);
    const backendId = this.containerId(sandbox, id);
    for (const patch of patches) {
      await this.backend.writeFile(backendId, patch.path, patch.content);
    }
    logger.info({ id, patches: patches.length }, 'sandbox.applyPatch');
    return this.restart(id);
  }

  async restart(id: string): Promise<Sandbox> {
    await this.transition(id, 'restarting');
    try {
      const sandbox = await this.require(id);
      await this.backend.restart(this.containerId(sandbox, id));
      return await this.transition(id, 'running');
    } catch (error) {
      await this.markFailed(id, error);
      throw error;
    }
  }

  async *collectLogs(id: string): AsyncIterable<string> {
    const sandbox = await this.require(id);
    yield* this.backend.logs(this.containerId(sandbox, id));
  }

  async destroy(id: string): Promise<void> {
    try {
      const sandbox = await this.require(id).catch(() => null);
      await this.backend
        .destroy((sandbox ? this.containerIdOr(sandbox) : undefined) ?? id)
        .catch(() => undefined);
    } catch (error) {
      logger.warn({ id, error }, 'sandbox.destroy backend error (continuing)');
    } finally {
      const now = new Date().toISOString();
      const existing = (await this.store.get(id).catch(() => null)) ?? null;
      const base: Sandbox = existing ?? {
        id,
        scanId: 'unknown',
        type: 'analysis',
        status: 'pending',
        image: '',
        repositoryPath: '',
        network: { egress: 'none', allowlist: [] },
        createdAt: now,
        updatedAt: now,
      };
      await this.store.save({ ...base, status: 'destroyed', updatedAt: now }).catch(() => undefined);
      await this.store.remove(id).catch(() => undefined);
      logger.info({ id }, 'sandbox.destroyed');
    }
  }

  async sweepOrphans(): Promise<number> {
    const swept = await this.backend.sweep();
    if (swept > 0) logger.warn({ swept }, 'sandbox.sweep reclaimed orphans');
    return swept;
  }

  // --- Runtime-sandbox primitives (Phase 6) ------------------------------

  async buildImage(request: BuildImageRequest): Promise<BuildImageResult> {
    const started = Date.now();
    logger.info({ image: request.imageName }, 'sandbox.buildImage start');
    try {
      const result = await this.backend.buildImage(request);
      logger.info(
        { image: request.imageName, imageId: result.imageId, durationMs: Date.now() - started },
        'sandbox.buildImage done'
      );
      return result;
    } catch (error) {
      logger.error({ image: request.imageName, error }, 'sandbox.buildImage failed');
      throw error;
    }
  }

  async removeImage(imageIdOrName: string): Promise<void> {
    logger.info({ image: imageIdOrName }, 'sandbox.removeImage');
    await this.backend.removeImage(imageIdOrName).catch((error) => {
      logger.warn({ image: imageIdOrName, error }, 'sandbox.removeImage failed (continuing)');
    });
  }

  async inspectRuntimeContainer(containerId: string): Promise<SandboxContainerInfo | null> {
    return this.backend.inspect(containerId).catch(() => null);
  }

  async probeNetworkHealth(request: NetworkHealthProbeRequest): Promise<HealthProbeResult> {
    return this.backend.probeNetworkHealth(request);
  }

  async executeToolInNetwork(request: ToolNetworkExecRequest): Promise<ExecResult> {
    return this.backend.executeToolInNetwork(request);
  }

  // -- internals -------------------------------------------------------------

  private networkEgress(
    type: 'analysis' | 'runtime',
    requested: CreateSandboxInput['egress'] | undefined
  ): 'none' | 'internal' | 'egress' {
    if (requested === 'egress' || requested === 'internal' || requested === 'none') return requested;
    if (type === 'runtime') return 'internal';
    return 'none'; // analysis default: no egress
  }

  private sandboxId(scanId: string): string {
    // Unique + scan-scoped so concurrent scans never collide.
    return `sbx_${scanId}_${randomUUID().slice(0, 8)}`;
  }

  /** Resolve the manager-facing `id` to the backend's handle. */
  private containerId(sandbox: Sandbox, id: string): string {
    if (sandbox.containerId) return sandbox.containerId;
    throw new Error(`sandbox ${id} has no backend handle yet`);
  }

  private containerIdOr(sandbox: Sandbox): string | undefined {
    return sandbox.containerId;
  }

  /** A per-call override can never exceed the sandbox's own policy. */
  private assertEgressAllowed(
    policy: 'none' | 'internal' | 'egress',
    requested: 'none' | 'internal' | 'egress',
    id: string
  ): void {
    const rank: Record<string, number> = { none: 0, internal: 1, egress: 2 };
    if ((rank[requested] ?? 0) > (rank[policy] ?? 0)) {
      throw new Error(`sandbox ${id}: per-call egress '${requested}' exceeds policy '${policy}'`);
    }
  }

  private async require(id: string): Promise<Sandbox> {
    const sandbox = await this.store.get(id);
    if (!sandbox) throw new Error(`sandbox not found: ${id}`);
    return sandbox;
  }

  private async transition(id: string, status: SandboxStatus): Promise<Sandbox> {
    const sandbox = await this.require(id);
    const next = { ...sandbox, status, updatedAt: new Date().toISOString() };
    await this.store.save(next);
    return next;
  }

  private async markFailed(id: string, error: unknown): Promise<void> {
    logger.error({ id, error }, 'sandbox entered failed state');
    await this.transition(id, 'failed').catch(() => undefined);
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}