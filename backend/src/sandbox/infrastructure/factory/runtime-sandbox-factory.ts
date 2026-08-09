import { runtimeSandboxConfig, type RuntimeSandboxConfig } from '../../../config';
import type { AmassEventPublisher } from '../../../observability/domain/ports/event-bus';
import type { SandboxManager } from '../../domain/ports/sandbox-manager';
import type { RuntimeHealthProber } from '../../domain/ports/runtime-health-prober';
import type { RuntimeSandboxRegistry } from '../../domain/ports/runtime-sandbox-registry';
import type { RuntimeSandboxStore } from '../../domain/ports/runtime-sandbox-store';
import type { RuntimeSandboxService } from '../../domain/ports/runtime-sandbox-service';
import type { RuntimeScanGateway } from '../../domain/ports/runtime-scan-gateway';
import type { RuntimeWorkspaceProvider } from '../../domain/ports/runtime-workspace-provider';
import { DefaultRuntimeSandboxService } from '../../application/services/runtime-sandbox.service';
import { MemoryRuntimeSandboxRegistry } from '../registry/memory-runtime-registry';
import { TcpHttpHealthProber } from '../health/tcp-http-health-prober';
import { FsRuntimeWorkspaceProvider } from '../workspace/fs-runtime-workspace-provider';
import type { PrismaClient } from '@prisma/client';
import { PrismaRuntimeSandboxRepository } from '../repositories/prisma-runtime-sandbox-repository';
import { PrismaRuntimeScanGateway } from '../repositories/prisma-runtime-scan-gateway';
import { GitRepositoryCloner } from '../../../repository-analysis/infrastructure/git/git-repository-cloner';

export interface RuntimeSandboxInfrastructureOptions {
  /** The application composition root's SINGLE shared manager — required so
   *  the runtime lifecycle and every agent see the same sandboxes. */
  readonly manager: SandboxManager;
  readonly store?: RuntimeSandboxStore;
  readonly registry?: RuntimeSandboxRegistry;
  readonly prober?: RuntimeHealthProber;
  readonly gateway?: RuntimeScanGateway;
  readonly workspace?: RuntimeWorkspaceProvider;
  /**
   * Prisma client used for the default store/gateway. Required so the
   * factory never touches a DB at module load; the application bootstrap
   * injects the shared singleton, tests inject an in-memory store instead.
   */
  readonly db: PrismaClient;
  /** Runtime config override (defaults to the env-driven shared config). */
  readonly config?: RuntimeSandboxConfig;
  /** Phase 9 event publisher (default: silent — no events). */
  readonly events?: AmassEventPublisher;
}

export interface RuntimeSandboxInfrastructure {
  readonly service: RuntimeSandboxService;
  readonly registry: RuntimeSandboxRegistry;
  readonly store: RuntimeSandboxStore;
}

/**
 * Composition root for runtime sandbox lifecycle. The manager is the shared
 * application instance (never built here). Defaults: Prisma store, memory
 * registry, TCP/HTTP prober, fs workspace with git clone.
 */
export function createRuntimeSandboxInfrastructure(
  options: RuntimeSandboxInfrastructureOptions
): RuntimeSandboxInfrastructure {
  const db = options.db;

  const store = options.store ?? new PrismaRuntimeSandboxRepository(db);
  const registry = options.registry ?? new MemoryRuntimeSandboxRegistry();
  const prober = options.prober ?? new TcpHttpHealthProber();
  const gateway = options.gateway ?? new PrismaRuntimeScanGateway(db);
  const workspace =
    options.workspace ?? new FsRuntimeWorkspaceProvider(new GitRepositoryCloner());

  const service = new DefaultRuntimeSandboxService({
    events: options.events,
    manager: options.manager,
    store,
    registry,
    prober,
    gateway,
    workspace,
    config: options.config ?? runtimeSandboxConfig,
  });

  return { service, registry, store };
}