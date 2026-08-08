import { logger } from '../../../config/logger';
import type { SandboxManager } from '../../domain/ports/sandbox-manager';
import type { RuntimeWorkspaceProvider } from '../../domain/ports/runtime-workspace-provider';
import type { RuntimeSandbox } from '../../domain/entities/runtime-sandbox';

export interface RuntimeCleanupOptions {
  readonly manager: SandboxManager;
  readonly workspace: RuntimeWorkspaceProvider;
  /** Remove the built image (default true; keeps debugging artifacts off by default). */
  readonly removeImage?: boolean;
}

/**
 * Best-effort resource reclamation for a FAILED/expired runtime sandbox.
 * Every step is independently guarded so a failure in one never prevents the
 * others; per-sandbox state and never throws (callers surface the ORIGINAL
 * failure, not a cleanup one).
 */
export class RuntimeCleanupCoordinator {
  private readonly manager: SandboxManager;
  private readonly workspace: RuntimeWorkspaceProvider;
  private readonly removeImage: boolean;

  constructor(options: RuntimeCleanupOptions) {
    this.manager = options.manager;
    this.workspace = options.workspace;
    this.removeImage = options.removeImage ?? true;
  }

  async cleanup(sandbox: RuntimeSandbox): Promise<{ imageRemoved: boolean; containerRemoved: boolean; workspaceRemoved: boolean }> {
    const started = Date.now();
    const result = { imageRemoved: false, containerRemoved: false, workspaceRemoved: false };

    if (sandbox.sandboxId) {
      await this.manager
        .destroy(sandbox.sandboxId)
        .then(() => {
          result.containerRemoved = true;
        })
        .catch((error) =>
          log('container', sandbox.id, error)
        );
    }

    if (this.removeImage && sandbox.imageId) {
      await this.manager
        .removeImage(sandbox.imageId)
        .then(() => {
          result.imageRemoved = true;
        })
        .catch((err) => log('image', sandbox.id, err));
    }

    if (sandbox.workspacePath) {
      await this.workspace
        .cleanup(sandbox.workspacePath)
        .then(() => {
          result.workspaceRemoved = true;
        })
        .catch((err) => log('workspace', sandbox.id, err));
    }

    logger.info(
      { sandboxId: sandbox.id, scanId: sandbox.scanId, durationMs: Date.now() - started, ...result },
      'runtime-sandbox.cleanup'
    );
    return result;
  }
}

function log(resource: string, sandboxId: string, error: unknown): void {
  logger.warn({ resource, sandboxId, error }, 'runtime-sandbox.cleanup partial failure');
}