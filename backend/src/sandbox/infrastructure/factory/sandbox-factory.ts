import os from 'node:os';
import path from 'node:path';
import { logger } from '../../../config/logger';
import type { SandboxManager } from '../../domain/ports/sandbox-manager';
import { SandboxManagerService } from '../../application/services/sandbox-manager.service';
import { MemorySandboxStore } from '../store/memory-sandbox-store';
import { ProcessSandboxBackend } from '../process-sandbox-backend';
import { DockerSandboxBackend } from '../docker/docker-sandbox-backend';

export interface SandboxInfrastructure {
  readonly manager: SandboxManager;
  /** Which backend is in effect ('process' | 'docker'). */
  readonly runtime: 'process' | 'docker';
}

/**
 * Composition root for the sandbox layer. The pipeline only ever sees a
 * `SandboxManager`; the backend choice is made here, from
 * `SANDBOX_RUNTIME`:
 *   - 'process' (default): real, no-Docker backend over the process sandbox
 *     (workspaces under a temp root) — used for local/headless runs.
 *   - 'docker': long-lived hardened containers (host deploy; verified
 *     against a fake runner in unit tests).
 */
export function createSandboxInfrastructure(
  options: { runtime?: 'process' | 'docker'; workspaceRoot?: string } = {}
): SandboxInfrastructure {
  const runtime = options.runtime ?? process.env.SANDBOX_RUNTIME ?? 'process';

  if (runtime === 'docker') {
    logger.info('sandbox.infrastructure: docker backend');
    return {
      manager: new SandboxManagerService({
        backend: new DockerSandboxBackend(),
        store: new MemorySandboxStore(),
      }),
      runtime: 'docker',
    };
  }

  const workspaceRoot = options.workspaceRoot ?? path.join(os.tmpdir(), 'amass-workspaces');
  logger.info({ workspaceRoot }, 'sandbox.infrastructure: process backend');
  return {
    manager: new SandboxManagerService({
      backend: new ProcessSandboxBackend({ workspaceRoot }),
      store: new MemorySandboxStore(),
    }),
    runtime: 'process',
  };
}