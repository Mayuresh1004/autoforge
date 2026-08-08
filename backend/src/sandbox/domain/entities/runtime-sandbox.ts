/**
 * Runtime sandbox domain entity — a RUNNING, containerized application
 * provisioned for a scan. Distinct from the ANALYSIS sandbox (which executes
 * scanners) and from the Sandbox Manager's own records: this is the
 * first-class lifecycle artifact the pipeline creates, health-checks, hands to
 * agents (Scout/Planner/Sniper) and destroys.
 *
 * Never create/destroy these from an agent: agents receive a ready
 * RuntimeSandbox context and consume only its read-only surface.
 */

export type RuntimeSandboxStatus =
  | 'CREATING'
  | 'BUILDING'
  | 'STARTING'
  | 'HEALTH_CHECKING'
  | 'READY'
  | 'FAILED'
  | 'DESTROYING'
  | 'DESTROYED'
  | 'EXPIRED';

export const RUNTIME_LIVE_STATUSES: readonly RuntimeSandboxStatus[] = [
  'CREATING',
  'BUILDING',
  'STARTING',
  'HEALTH_CHECKING',
  'READY',
  'DESTROYING',
] as const;

export const RUNTIME_TERMINAL_STATUSES: readonly RuntimeSandboxStatus[] = [
  'FAILED',
  'DESTROYED',
  'EXPIRED',
] as const;

/** Repository reference for a sandbox: either a remote URL (cloned) or a local path (copied). */
export interface RuntimeRepositoryRef {
  readonly name?: string;
  readonly url?: string;
  readonly path?: string;
}

export interface RuntimeSandbox {
  readonly id: string;
  readonly scanId: string;
  readonly status: RuntimeSandboxStatus;
  readonly repository: RuntimeRepositoryRef;
  /** Manager-side sandbox id of the running container (what agents consume). */
  readonly sandboxId: string | null;
  readonly name?: string | null;
  readonly imageId: string | null;
  readonly imageName: string | null;
  /** Scan-scoped internal network this app participates in. */
  readonly networkId: string | null;
  /** Host-reachable URL of the application (container IP). */
  readonly targetUrl: string | null;
  /** IP of the app container on the sandbox network. */
  readonly internalHost: string | null;
  /** Port the app listens on inside the container. */
  readonly internalPort: number | null;
  /** Allocated localhost host port when published (else null). */
  readonly exposedPort: number | null;
  /** Ephemeral workspace (build context). Removed with the sandbox. */
  readonly workspacePath: string | null;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly destroyedAt: string | null;
  readonly failureStage: string | null;
  readonly failureReason: string | null;
}

/** Read-only context agents receive — never the lifecycle handles. */
export interface RuntimeSandboxContext {
  readonly id: string;
  readonly scanId: string;
  readonly sandboxId: string;
  readonly targetUrl: string;
  readonly internalHost: string;
  readonly internalPort: number;
  readonly exposedPort: number | null;
}

/** Derive the agent-facing context from a ready runtime sandbox. */
export function toRuntimeContext(sandbox: RuntimeSandbox): RuntimeSandboxContext {
  const { id, scanId, sandboxId, targetUrl, internalHost, internalPort, exposedPort } = sandbox;
  if (!sandboxId || !targetUrl || !internalHost || !internalPort) {
    throw new Error(`runtime sandbox ${id} is not usable: missing connection info`);
  }
  return {
    id,
    scanId,
    sandboxId,
    targetUrl,
    internalHost,
    internalPort,
    exposedPort,
  };
}