import type { RuntimeRepositoryRef } from '../entities/runtime-sandbox';
import type { RuntimeSandbox } from '../entities/runtime-sandbox';
import type { ResourceLimits } from '../value-objects/runtime-config';

export interface CreateRuntimeSandboxRequest {
  readonly scanId: string;
  /** Controller-validated repository reference (URL xor local path). */
  readonly repository: RuntimeRepositoryRef;
  /** Optional display name (never user-controlled commands). */
  readonly name?: string;
  /** Bounded lifetime override (defaults to SANDBOX_TIMEOUT). */
  readonly maxAgeMs?: number;
  /** Bind a dynamic localhost-only host port (default off). */
  readonly hostExpose?: boolean;
  /** Optionally override detected app port (Mode 1 repos with weird setups). */
  readonly portOverride?: number;
}

export interface RuntimeHealthResult {
  readonly ok: boolean;
  readonly status: import('../entities/runtime-sandbox').RuntimeSandboxStatus;
  readonly latencyMs?: number;
  readonly statusCode?: number;
  readonly detail?: string;
  readonly checkedAt: string;
}

/**
 * The runtime-sandbox lifecycle service — the ONLY component allowed to
 * provision/destroy runtime sandboxes. Agents never see this port: they
 * consume `RuntimeSandboxContext`.
 */
export interface RuntimeSandboxService {
  /** Full provision flow: validate → workspace → build → start → health → READY. */
  create(input: CreateRuntimeSandboxRequest): Promise<RuntimeSandbox>;
  /** Read by id; optional scanId scoping for the caller (authorization). */
  get(id: string, options?: { readonly scanId?: string }): Promise<RuntimeSandbox>;
  /** Re-run the application health check. */
  healthCheck(id: string, options?: { readonly scanId?: string }): Promise<RuntimeHealthResult>;
  /** Destroy the sandbox and every resource it holds. Idempotent. */
  destroy(id: string, options?: { readonly scanId?: string }): Promise<RuntimeSandbox>;
  /** Expire a sandbox (lifetime over): marks EXPIRED and cleans up. */
  expire(id: string): Promise<RuntimeSandbox>;
  /** Reclaim expired/failed/stale sandboxes. Returns how many were cleaned. */
  cleanupExpired(): Promise<number>;
  /** Resource limit envelope applied to every runtime container. */
  readonly limits: ResourceLimits;
}