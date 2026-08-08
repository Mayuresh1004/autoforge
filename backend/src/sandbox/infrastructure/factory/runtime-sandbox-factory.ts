import { runtimeSandboxConfig } from '../../../config';
import { prisma as defaultPrisma } from '../../../config/database';
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
import { PrismaRuntimeSandboxRepository } from '../repositories/prisma-runtime-sandbox-repository';
import { PrismaRuntimeScanGateway } from '../repositories/prisma-runtime-scan-gateway';
import { GitRepositoryCloner } from '../../../repository-analysis/infrastructure/git/git-repository-cloner';
import { createSandboxInfrastructure } from './sandbox-factory';

export interface RuntimeSandboxInfrastructureOptions {
  readonly manager?: SandboxManager;
  readonly store?: RuntimeSandboxStore;
  readonly registry?: RuntimeSandboxRegistry;
  readonly prober?: RuntimeHealthProber;
  readonly gateway?: RuntimeScanGateway;
  readonly workspace?: RuntimeWorkspaceProvider;
  /**
   * overrideDb: inject for tests/e2e; production uses the shared singleton.
   */
  readonly db?: typeof defaultPrisma;
}

export interface RuntimeSandboxInfrastructure {
  readonly service: RuntimeSandboxService;
  readonly registry: RuntimeSandboxRegistry;
  readonly store: RuntimeSandboxStore;
}

/**
 * Composition root for runtime sandbox lifecycle. Defaults are the real,
 * Docker-capable stack: Sandbox Manager (docker backend), Prisma store,
 * memory registry, TCP/HTTP prober, fs workspace with git clone.
 */
export function createRuntimeSandboxInfrastructure(
  options: RuntimeSandboxInfrastructureOptions = {}
): RuntimeSandboxInfrastructure {
  const { manager: sandboxManager } = createSandboxInfrastructure({ runtime: 'docker' });
  const db = options.db ?? defaultPrisma;

  const store = options.store ?? new PrismaRuntimeSandboxRepository(db);
  const registry = options.registry ?? new MemoryRuntimeSandboxRegistry();
  const prober = options.prober ?? new TcpHttpHealthProber();
  const gateway = options.gateway ?? new PrismaRuntimeScanGateway(db);
  const workspace =
    options.workspace ?? new FsRuntimeWorkspaceProvider(new GitRepositoryCloner());

  const service = new DefaultRuntimeSandboxService({
    manager: options.manager ?? sandboxManager,
    store,
    registry,
    prober,
    gateway,
    workspace,
    config: runtimeSandboxConfig,
  });

  return { service, registry, store };
}