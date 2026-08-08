import { randomUUID } from 'node:crypto';
import type { RuntimeSandboxConfig } from '../../../config';
import { logger } from '../../../config/logger';
import type { RuntimeSandbox } from '../../domain/entities/runtime-sandbox';
import { InvalidRuntimeRepositoryError } from '../../domain/errors/runtime-sandbox.errors';
import type { SandboxManager } from '../../domain/ports/sandbox-manager';
import type { RuntimeHealthProber } from '../../domain/ports/runtime-health-prober';
import type { RuntimeSandboxRegistry } from '../../domain/ports/runtime-sandbox-registry';
import type { RuntimeSandboxStore } from '../../domain/ports/runtime-sandbox-store';
import type { RuntimeScanGateway } from '../../domain/ports/runtime-scan-gateway';
import type { RuntimeWorkspaceProvider } from '../../domain/ports/runtime-workspace-provider';
import type { CreateRuntimeSandboxRequest } from '../../domain/ports/runtime-sandbox-service';

/** Everything the runtime lifecycle needs beyond the container provisioning. */
export interface DefaultRuntimeSandboxServiceDeps {
  readonly manager: SandboxManager;
  readonly store: RuntimeSandboxStore;
  readonly registry: RuntimeSandboxRegistry;
  readonly prober: RuntimeHealthProber;
  readonly gateway: RuntimeScanGateway;
  readonly workspace: RuntimeWorkspaceProvider;
  readonly config: RuntimeSandboxConfig;
}

export const IMAGE_NAME_PREFIX = 'amass-rt';
export const REASON_TRUNCATE = 800;
export const MIN_LIFETIME_MS = 60_000;

/** New CREATING record with a bounded lifetime. */
export function seedRuntimeSandbox(input: CreateRuntimeSandboxRequest, maxAgeMs: number): RuntimeSandbox {
  return {
    id: `rts_${randomUUID().slice(0, 12)}`,
    scanId: input.scanId,
    status: 'CREATING',
    repository: input.repository,
    name: input.name,
    sandboxId: null,
    imageId: null,
    imageName: null,
    networkId: null,
    targetUrl: null,
    internalHost: null,
    internalPort: null,
    exposedPort: null,
    workspacePath: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + maxAgeMs).toISOString(),
    destroyedAt: null,
    failureStage: null,
    failureReason: null,
  };
}

/** Persist every mutation through the store (each patch is durable). */
export async function patchSandbox(
  store: RuntimeSandboxStore,
  sandbox: RuntimeSandbox,
  next: Partial<RuntimeSandbox>
): Promise<RuntimeSandbox> {
  const updated: RuntimeSandbox = { ...sandbox, ...next };
  await store.save(updated);
  return updated;
}

export function logSandbox(event: string, sandbox: RuntimeSandbox, extra: Record<string, unknown>): void {
  logger.info(
    { sandboxId: sandbox.id, scanId: sandbox.scanId, status: sandbox.status, ...extra },
    `runtime-sandbox:${event}`
  );
}

/**
 * Ownership gate: the scan must exist AND the repository must be linked to
 * it (or be a local path). Prevents provisioning for unrelated units of work.
 */
export async function validateOwnership(
  gateway: RuntimeScanGateway,
  input: CreateRuntimeSandboxRequest
): Promise<void> {
  if (!(await gateway.scanExists(input.scanId))) {
    throw new InvalidRuntimeRepositoryError(`scan ${input.scanId} does not exist`);
  }
  const relation = await gateway.scanRepositoryRelation(input.scanId, input.repository);
  if (relation === false) {
    throw new InvalidRuntimeRepositoryError(`repository not linked to scan ${input.scanId}`);
  }
}