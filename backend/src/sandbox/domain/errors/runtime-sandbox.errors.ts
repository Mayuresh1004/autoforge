/**
 * Runtime-sandbox domain errors. All carry a stable `code` so the API layer
 * can map them to structured responses (404/403/422/429) without string
 * matching. Cleanup failures are wrapped, never swallowed silently.
 */

export type RuntimeFailureStage =
  | 'VALIDATION'
  | 'CAPACITY'
  | 'WORKSPACE'
  | 'REPOSITORY'
  | 'RUNTIME_DETECTION'
  | 'IMAGE_BUILD'
  | 'CONTAINER_START'
  | 'HEALTH_CHECK'
  | 'DESTROY'
  | 'BACKEND';

export class RuntimeSandboxError extends Error {
  readonly code: string = 'RUNTIME_SANDBOX_ERROR';
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'RuntimeSandboxError';
  }
}

export class RuntimeSandboxNotFoundError extends RuntimeSandboxError {
  readonly code = 'RUNTIME_SANDBOX_NOT_FOUND';
  constructor(id: string) {
    super(`runtime sandbox not found: ${id}`);
    this.name = 'RuntimeSandboxNotFoundError';
  }
}

/** Caller provided a scanId that does not own this sandbox. */
export class RuntimeSandboxForbiddenError extends RuntimeSandboxError {
  readonly code = 'RUNTIME_SANDBOX_FORBIDDEN';
  constructor(id: string, scanId: string) {
    super(`runtime sandbox ${id} does not belong to scan ${scanId}`);
    this.name = 'RuntimeSandboxForbiddenError';
  }
}

/** Concurrency ceiling reached — never silently queued. */
export class RuntimeSandboxCapacityError extends RuntimeSandboxError {
  readonly code = 'RUNTIME_SANDBOX_CAPACITY';
  readonly active: number;
  readonly max: number;
  constructor(active: number, max: number) {
    super(`runtime sandbox capacity reached (${active} active of ${max} max)`);
    this.name = 'RuntimeSandboxCapacityError';
    this.active = active;
    this.max = max;
  }
}

export class InvalidRuntimeRepositoryError extends RuntimeSandboxError {
  readonly code = 'INVALID_RUNTIME_REPOSITORY';
  constructor(detail: string) {
    super(`invalid runtime repository: ${detail}`);
    this.name = 'InvalidRuntimeRepositoryError';
  }
}

/**
 * `hostExpose: true` was requested but host port publishing is disabled in
 * config (`SANDBOX_ALLOW_HOST_EXPOSE=false`, the secure default). Fail fast
 * with a typed error instead of silently dropping the request and later
 * failing health probes from the host side.
 */
export class RuntimeSandboxHostExposureDeniedError extends RuntimeSandboxError {
  readonly code = 'HOST_EXPOSURE_DENIED';
  constructor() {
    super(
      'host port publishing is disabled (SANDBOX_ALLOW_HOST_EXPOSE=false); ' +
        'set it to expose the app on 127.0.0.1 or create without hostExpose'
    );
    this.name = 'RuntimeSandboxHostExposureDeniedError';
  }
}

export class UnsupportedRuntimeError extends RuntimeSandboxError {
  readonly code = 'UNSUPPORTED_RUNTIME';
  /** Files that triggered the detection (kept short). */
  readonly hints: readonly string[];
  constructor(hints: readonly string[]) {
    super(`unsupported runtime for sandbox provisioning (hints: ${hints.join(', ') || 'none'})`);
    this.name = 'UnsupportedRuntimeError';
    this.hints = hints;
  }
}

/**
 * A sandbox creation attempt ended in FAILED. Carries the persisted entity
 * (with failureStage/failureReason) so callers can surface the structured
 * failure while still showing the record.
 */
export class RuntimeSandboxCreationError extends RuntimeSandboxError {
  readonly code = 'RUNTIME_SANDBOX_CREATION_FAILED';
  readonly stage: RuntimeFailureStage;
  readonly sandbox: import('../entities/runtime-sandbox').RuntimeSandbox | null;
  readonly cleanup: { readonly imageRemoved: boolean; readonly workspaceRemoved: boolean };
  constructor(
    stage: RuntimeFailureStage,
    detail: string,
    cause: unknown,
    sandbox: import('../entities/runtime-sandbox').RuntimeSandbox | null = null
  ) {
    super(`runtime sandbox creation failed at '${stage}': ${detail}`, { cause });
    this.name = 'RuntimeSandboxCreationError';
    this.stage = stage;
    this.sandbox = sandbox;
    this.cleanup = { imageRemoved: false, workspaceRemoved: false };
  }
}