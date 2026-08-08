import { z } from 'zod';
import type { RuntimeSandbox, RuntimeSandboxStatus } from '../../domain/entities/runtime-sandbox';

/** POST /sandboxes/runtime — provision a runtime sandbox for an existing scan. */
export const CreateRuntimeSandboxRequestSchema = z.object({
  /** The scan this sandbox serves (authorization scope). */
  scanId: z.string().min(1),
  /** Repository reference: a remote URL (cloned) or a local directory path (copied). */
  repository: z
    .object({
      url: z.string().url().optional(),
      path: z.string().min(1).optional(),
    })
    .refine((r) => Boolean(r.url) !== Boolean(r.path), {
      message: 'provide exactly one of repository.url or repository.path',
    }),
  name: z.string().max(120).optional(),
  /** Bind a dynamic localhost-only host port (opt-in; default off). */
  hostExpose: z.boolean().optional(),
  /** Override the detected application port (advanced). */
  portOverride: z.number().int().min(1).max(65535).optional(),
});

export type CreateRuntimeSandboxRequest = z.infer<typeof CreateRuntimeSandboxRequestSchema>;

/** API representation of a runtime sandbox (never raw Docker handles). */
export interface RuntimeSandboxResponse {
  readonly id: string;
  readonly scanId: string;
  readonly status: RuntimeSandboxStatus;
  readonly name: string | null;
  readonly repository: {
    readonly name?: string;
    readonly url?: string;
    readonly path?: string;
  };
  /** Manager-side sandbox id (agents consume this, e.g. Sniper `sandboxId`). */
  readonly sandboxId: string | null;
  readonly imageName: string | null;
  readonly networkId: string | null;
  readonly targetUrl: string | null;
  readonly internalHost: string | null;
  readonly internalPort: number | null;
  readonly exposedPort: number | null;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly destroyedAt: string | null;
  readonly failureStage: string | null;
  readonly failureReason: string | null;
}

export function toRuntimeSandboxResponse(sandbox: RuntimeSandbox): RuntimeSandboxResponse {
  return {
    id: sandbox.id,
    scanId: sandbox.scanId,
    status: sandbox.status,
    name: sandbox.name ?? null,
    repository: {
      ...(sandbox.repository.name ? { name: sandbox.repository.name } : {}),
      ...(sandbox.repository.url ? { url: sandbox.repository.url } : {}),
      ...(sandbox.repository.path ? { path: sandbox.repository.path } : {}),
    },
    sandboxId: sandbox.sandboxId,
    imageName: sandbox.imageName,
    networkId: sandbox.networkId,
    targetUrl: sandbox.targetUrl,
    internalHost: sandbox.internalHost,
    internalPort: sandbox.internalPort,
    exposedPort: sandbox.exposedPort,
    createdAt: sandbox.createdAt,
    expiresAt: sandbox.expiresAt,
    destroyedAt: sandbox.destroyedAt,
    failureStage: sandbox.failureStage,
    failureReason: sandbox.failureReason,
  };
}