import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../../../config/logger';
import type { RuntimeSandbox } from '../../domain/entities/runtime-sandbox';
import { RUNTIME_LIVE_STATUSES } from '../../domain/entities/runtime-sandbox';
import {
  RuntimeSandboxCapacityError,
  RuntimeSandboxCreationError,
  RuntimeSandboxError,
  RuntimeSandboxForbiddenError,
  RuntimeSandboxHostExposureDeniedError,
  RuntimeSandboxNotFoundError,
} from '../../domain/errors/runtime-sandbox.errors';
import type {
  CreateRuntimeSandboxRequest,
  RuntimeHealthResult,
  RuntimeSandboxService,
} from '../../domain/ports/runtime-sandbox-service';
import type { ResourceLimits } from '../../domain/value-objects/runtime-config';
import { resolveRuntimeConfig } from './runtime-config-resolver';
import { RuntimeCleanupCoordinator } from './runtime-cleanup';
import {
  buildHealthProbe,
  buildProvisionRequest,
  probeWithRetries,
  provisionContainer,
  type RuntimeProvisionDeps,
} from './runtime-sandbox-provisioning';
import type { AmassEventPublisher } from '../../../observability/domain/ports/event-bus';
import type { AmassEventInput } from '../../../observability/domain/ports/event-bus';
import { buildTargetUrl, clamp, classifyStage, sanitizeKey } from './runtime-sandbox-utils';
import {
  IMAGE_NAME_PREFIX,
  logSandbox,
  MIN_LIFETIME_MS,
  patchSandbox,
  REASON_TRUNCATE,
  seedRuntimeSandbox,
  validateOwnership,
  type DefaultRuntimeSandboxServiceDeps,
} from './runtime-sandbox-state';

/**
 * The runtime-sandbox lifecycle orchestrator — the ONLY component allowed to
 * provision/destroy runtime sandboxes (agents consume read-only contexts).
 * Flow: ownership validation → ephemeral workspace → deterministic build
 * (Mode 1/2) → isolated-network hardened container → TCP+HTTP health check →
 * READY. Any failure persists FAILED, collects logs, reclaims every resource
 * and surfaces a structured error. Capacity is a hard ceiling — a structured
 * error is returned, never a silent queue.
 */
export class DefaultRuntimeSandboxService implements RuntimeSandboxService {
  readonly limits: ResourceLimits;
  private readonly cleanup: RuntimeCleanupCoordinator;
  private readonly provisioning: RuntimeProvisionDeps;

  constructor(private readonly deps: DefaultRuntimeSandboxServiceDeps) {
    this.limits = deps.config.limits;
    this.cleanup = new RuntimeCleanupCoordinator({
      manager: deps.manager,
      workspace: deps.workspace,
    });
    this.provisioning = {
      manager: deps.manager,
      prober: deps.prober,
      config: deps.config,
    };
  }

  async create(input: CreateRuntimeSandboxRequest): Promise<RuntimeSandbox> {
    const started = Date.now();
    // Fail fast on an explicit hostExpose request when host publishing is
    // disabled — never silently drop it (MEDIUM-6). Checked before ANY
    // side effect so no FAILED record / image is ever produced.
    if (input.hostExpose === true && !this.deps.config.allowHostExpose) {
      throw new RuntimeSandboxHostExposureDeniedError();
    }
    const maxAgeMs = clamp(
      input.maxAgeMs ?? this.deps.config.lifetimeMs,
      MIN_LIFETIME_MS,
      this.deps.config.lifetimeMs
    );

    await this.cleanupExpired().catch((err) =>
      logger.warn({ err }, 'runtime-sandbox.cleanupExpired failed')
    );

    const active = await this.deps.registry.countActive();
    if (active >= this.deps.config.maxConcurrent) {
      throw new RuntimeSandboxCapacityError(active, this.deps.config.maxConcurrent);
    }

    await validateOwnership(this.deps.gateway, input);

    this.publish({
      scanId: input.scanId,
      eventType: 'SANDBOX_PROVISIONING',
      agentType: 'SANDBOX',
      phase: 'sandbox',
      status: 'STARTED',
      message: 'provisioning runtime sandbox',
      metadata: { runtime: this.deps.config.runtime },
    });

    let sandbox = seedRuntimeSandbox(input, maxAgeMs);
    try {
      await this.deps.store.save(sandbox);
      await this.deps.registry.register(sandbox);
      logSandbox('create:start', sandbox, { maxAgeMs });

      // 1. Ephemeral workspace — the repository is transported, never executed.
      const prepared = await this.deps.workspace.prepare(input.repository);
      sandbox = await patchSandbox(this.deps.store, sandbox, { workspacePath: prepared.workspacePath });

      // 2. Deterministic runtime strategy (Mode 1 Dockerfile / Mode 2 template).
      const resolved = await resolveRuntimeConfig(prepared.repoPath, input.portOverride);
      if (resolved.generatedDockerfile) {
        await fs.writeFile(
          path.join(prepared.repoPath, 'Dockerfile'),
          resolved.generatedDockerfile,
          'utf8'
        );
      }
      sandbox = await patchSandbox(this.deps.store, sandbox, { status: 'BUILDING' });

      // 3. Build the image through the manager (the only Docker owner).
      const imageName = `${IMAGE_NAME_PREFIX}-${sanitizeKey(input.scanId)}-${randomUUID().slice(0, 8)}`;
      const { imageId } = await this.deps.manager.buildImage({
        contextPath: prepared.repoPath,
        // Mode 1: resolve the repo Dockerfile against the CONTEXT, not the
        // process CWD (docker -f is relative to CWD unless absolute).
        dockerfilePath: resolved.config.dockerfile
          ? path.join(prepared.repoPath, resolved.config.dockerfile.path)
          : undefined,
        imageName,
        timeoutMs: this.deps.config.buildTimeoutMs,
        labels: { 'amass.manager': '1', 'amass.scan': input.scanId, 'amass.runtime': '1' },
      });
      sandbox = await patchSandbox(this.deps.store, sandbox, { imageId, imageName });

      // 4. Hardened container: internal network, no host mounts, explicit env
      //    allowlist, bounded CPU/memory/PIDs, image-CMD start, optional
      //    localhost-only dynamic host port.
      const request = buildProvisionRequest(sandbox, resolved.config, input, this.deps.config);
      const contact = await provisionContainer(this.provisioning, request);
      sandbox = await patchSandbox(this.deps.store, sandbox, {
        status: 'STARTING',
        sandboxId: contact.containerId,
        networkId: contact.networkId,
        internalHost: contact.ip,
        internalPort: resolved.config.port,
        exposedPort: contact.publishedPort,
        targetUrl: buildTargetUrl(contact.publishedPort, contact.ip, resolved.config.port),
      });

      // 5. Real health verification (TCP + HTTP) — a running container alone
      //    never means READY. Bounded retries absorb the app's boot window
      //    (a freshly started process rejects connections until it binds).
      //    Probes respect the connectivity model: host-exposed sandboxes are
      //    checked over the localhost-only published port; isolated sandboxes
      //    are checked from a probe container INSIDE their internal network
      //    (the backend process cannot reach an `--internal` Docker IP).
      sandbox = await patchSandbox(this.deps.store, sandbox, { status: 'HEALTH_CHECKING' });
      const healthStartTime = Date.now();
      const probe = await probeWithRetries(
        (singleTimeoutMs) =>
          buildHealthProbe(this.provisioning, sandbox, resolved.config.healthPath, singleTimeoutMs)(),
        {
          totalTimeoutMs: this.deps.config.healthTimeoutMs,
          pollIntervalMs: 1_000,
          singleProbeTimeoutMs: 5_000,
          sandbox,
          deps: this.provisioning,
        }
      );
      if (!probe.reachable) {
        const elapsedMs = Date.now() - healthStartTime;
        const targetHost = sandbox.exposedPort ? '127.0.0.1' : (sandbox.internalHost ?? 'unknown');
        const targetPort = sandbox.exposedPort ?? sandbox.internalPort ?? 0;

        let containerDiagnostics = '';
        if (sandbox.sandboxId) {
          const info = await this.deps.manager.inspectRuntimeContainer(sandbox.sandboxId).catch(() => null);
          if (info) {
            containerDiagnostics = ` [status: ${info.status}, running: ${info.running}${info.exitCode !== undefined ? `, exitCode: ${info.exitCode}` : ''}]`;
          }
        }

        const diagnosticDetail = `application health check failed after ${elapsedMs}ms: ${probe.detail ?? 'unreachable'} (target ${targetHost}:${targetPort})${containerDiagnostics}`;
        throw new Error(diagnosticDetail);
      }

      sandbox = await patchSandbox(this.deps.store, sandbox, { status: 'READY' });
      this.publish({
        scanId: input.scanId,
        eventType: 'SANDBOX_READY',
        agentType: 'SANDBOX',
        phase: 'sandbox',
        status: 'READY',
        message: `sandbox ${sandbox.sandboxId ?? 'unknown'} ready`,
        metadata: {
          sandboxId: sandbox.sandboxId ?? undefined,
          targetUrl: sandbox.targetUrl ?? undefined,
          runtime: this.deps.config.runtime,
          readiness: 'READY',
        },
      });
      logSandbox('create:ready', sandbox, { durationMs: Date.now() - started });
      return sandbox;
    } catch (error) {
      return this.fail(sandbox, error);
    }
  }

  async get(id: string, options: { scanId?: string } = {}): Promise<RuntimeSandbox> {
    const sandbox = await this.deps.store.get(id);
    if (!sandbox) throw new RuntimeSandboxNotFoundError(id);
    if (options.scanId && sandbox.scanId !== options.scanId) {
      throw new RuntimeSandboxForbiddenError(id, options.scanId);
    }
    return sandbox;
  }

  async healthCheck(id: string, options: { scanId?: string } = {}): Promise<RuntimeHealthResult> {
    const sandbox = await this.get(id, options);
    if (sandbox.status !== 'READY') {
      return {
        ok: false,
        status: sandbox.status,
        detail: `sandbox is '${sandbox.status}', not READY`,
        checkedAt: new Date().toISOString(),
      };
    }
    const probe = await buildHealthProbe(this.provisioning, sandbox, '/')();
    return {
      ok: probe.reachable,
      status: sandbox.status,
      latencyMs: probe.latencyMs,
      statusCode: probe.statusCode,
      detail: probe.detail,
      checkedAt: new Date().toISOString(),
    };
  }

  async destroy(id: string, options: { scanId?: string } = {}): Promise<RuntimeSandbox> {
    const sandbox = await this.get(id, options);
    if (sandbox.status === 'DESTROYED' || sandbox.status === 'EXPIRED') return sandbox; // idempotent
    const destroying = await patchSandbox(this.deps.store, sandbox, { status: 'DESTROYING' });
    this.publish({
      scanId: sandbox.scanId,
      eventType: 'SANDBOX_DESTROYING',
      agentType: 'SANDBOX',
      phase: 'sandbox',
      status: 'DESTROYING',
      message: `destroying sandbox ${id}`,
      metadata: { sandboxId: sandbox.sandboxId ?? undefined },
    });
    await this.cleanup.cleanup(destroying);
    const destroyed = await patchSandbox(this.deps.store, destroying, {
      status: 'DESTROYED',
      destroyedAt: new Date().toISOString(),
    });
    this.publish({
      scanId: sandbox.scanId,
      eventType: 'SANDBOX_DESTROYED',
      agentType: 'SANDBOX',
      phase: 'sandbox',
      status: 'DESTROYED',
      message: `sandbox ${id} destroyed`,
      metadata: { sandboxId: sandbox.sandboxId ?? undefined },
    });
    await this.deps.registry.remove(id);
    logSandbox('destroy:done', destroyed, {});
    return destroyed;
  }

  async expire(id: string): Promise<RuntimeSandbox> {
    const sandbox = await this.deps.store.get(id);
    if (!sandbox) throw new RuntimeSandboxNotFoundError(id);
    if (sandbox.status === 'DESTROYED' || sandbox.status === 'EXPIRED') return sandbox;
    const expiring = await patchSandbox(this.deps.store, sandbox, { status: 'EXPIRED' });
    this.publish({
      scanId: sandbox.scanId,
      eventType: 'SANDBOX_DESTROYED',
      agentType: 'SANDBOX',
      phase: 'sandbox',
      status: 'DESTROYED',
      message: `sandbox ${id} expired and reclaimed`,
      metadata: { sandboxId: sandbox.sandboxId ?? undefined },
    });
    await this.cleanup.cleanup(expiring);
    await this.deps.registry.remove(id);
    logSandbox('expire:done', expiring, {});
    return expiring;
  }

  /**
   * Reclaim anything past its bounded lifetime (live states expire; FAILED
   * records are cleaned without a terminal status flip). Called on each
   * create and by the controller's sweep endpoint.
   */
  async cleanupExpired(): Promise<number> {
    const now = Date.now();
    let reclaimed = 0;
    for (const status of RUNTIME_LIVE_STATUSES) {
      for (const sandbox of await this.deps.store.listByStatus([status])) {
        if (sandbox.expiresAt && Date.parse(sandbox.expiresAt) <= now) {
          await this.expire(sandbox.id).catch((err) =>
            logger.warn({ err, id: sandbox.id }, 'runtime-sandbox.expire failed')
          );
          reclaimed += 1;
        }
      }
    }
    for (const sandbox of await this.deps.store.listByStatus(['FAILED'])) {
      await this.cleanup.cleanup(sandbox);
      await this.deps.registry.remove(sandbox.id);
      reclaimed += 1;
    }
    if (reclaimed > 0) {
      logger.info({ reclaimed }, 'runtime-sandbox.cleanupExpired');
    }
    return reclaimed;
  }

  // -- internals ---------------------------------------------------------

  private publish(input: AmassEventInput): void {
    if (!this.deps.events) return;
    try {
      this.deps.events.publish(input);
    } catch (err) {
      logger.warn({ err, scanId: input.scanId }, 'runtime-sandbox.events: publish ignored');
    }
  }

  private async fail(sandbox: RuntimeSandbox, error: unknown): Promise<never> {
    const stage = classifyStage(error);
    const reason = error instanceof Error ? error.message.slice(0, REASON_TRUNCATE) : String(error);
    const failed = await patchSandbox(this.deps.store, sandbox, {
      status: 'FAILED',
      failureStage: stage,
      failureReason: reason,
    }).catch(() => sandbox);

    this.publish({
      scanId: failed.scanId,
      eventType: 'SANDBOX_FAILED',
      agentType: 'SANDBOX',
      phase: 'sandbox',
      level: 'ERROR',
      status: 'FAILED',
      message: `sandbox provisioning failed at ${stage}`,
      metadata: { sandboxId: failed.sandboxId ?? undefined, error: reason, check: stage },
    });

    await this.collectFailureLogs(failed).catch(() => undefined);
    await this.cleanup.cleanup(failed);
    await this.deps.registry.remove(failed.id).catch(() => undefined);
    logSandbox('create:failed', failed, { stage });

    if (error instanceof RuntimeSandboxError) throw error;
    throw new RuntimeSandboxCreationError(stage, reason, error, failed);
  }

  private async collectFailureLogs(sandbox: RuntimeSandbox): Promise<void> {
    if (!sandbox.sandboxId) return;
    let count = 0;
    for await (const _line of this.deps.manager.collectLogs(sandbox.sandboxId)) {
      count += 1;
      if (count >= 50) break;
    }
    if (count > 0) logSandbox('failure-logs', sandbox, { lineCount: count });
  }
}