/**
 * Critic Agent typed errors. Every failure path maps onto a bounded
 * CriticFailureKind so callers can distinguish "the patch is bad" from
 * "the validation environment broke" without parsing messages.
 */

export type CriticErrorCode =
  | 'PATCH_NOT_FOUND'
  | 'INVALID_PATCH_STATUS'
  | 'UNSUPPORTED_VULNERABILITY'
  | 'BASELINE_INVALID'
  | 'SANDBOX_PROVISION_FAILURE'
  | 'APPLICATION_START_FAILURE'
  | 'PATCH_CONFLICT'
  | 'PATCH_APPLY_FAILED'
  | 'EXPLOIT_RETEST_FAILED'
  | 'EXPLOIT_STILL_SUCCEEDS'
  | 'VALIDATION_INFRASTRUCTURE_FAILURE'
  | 'PATCH_REJECTED';

export class CriticError extends Error {
  readonly code: CriticErrorCode;
  constructor(code: CriticErrorCode, message: string) {
    super(message);
    this.name = 'CriticError';
    this.code = code;
  }
}

export class PatchNotFoundError extends CriticError {
  constructor(patchId: string) {
    super('PATCH_NOT_FOUND', `patch ${patchId} not found`);
  }
}

/** Deterministic state-transition rejection (e.g. validating an APPLIED patch). */
export class InvalidPatchStatusError extends CriticError {
  constructor(patchId: string, status: string) {
    super('INVALID_PATCH_STATUS', `patch ${patchId} is not reviewable (status=${status})`);
  }
}

export class UnsupportedVulnerabilityError extends CriticError {
  constructor(vulnerabilityId: string, status: string, type: string) {
    super('UNSUPPORTED_VULNERABILITY', `vulnerability ${vulnerabilityId} is not a CONFIRMED SQL_INJECTION (status=${status} type=${type})`);
  }
}

export class SandboxProvisionFailure extends CriticError {
  constructor(message: string) {
    super('SANDBOX_PROVISION_FAILURE', message);
  }
}

export class BaselineInvalidError extends CriticError {
  constructor(reason: string) {
    super('BASELINE_INVALID', reason);
  }
}

export class ApplicationStartFailure extends CriticError {
  constructor(message: string) {
    super('APPLICATION_START_FAILURE', message);
  }
}

export class PatchConflictError extends CriticError {
  constructor(message: string) {
    super('PATCH_CONFLICT', message);
  }
}

export class ExploitStillSucceedsError extends CriticError {
  constructor(reason: string) {
    super('EXPLOIT_STILL_SUCCEEDS', reason);
  }
}

/** The retest ran but produced no decisive verdict (infrastructure uncertainty). */
export class ExploitInconclusiveError extends CriticError {
  constructor(detail: string) {
    super('EXPLOIT_RETEST_FAILED', `exploit retest is inconclusive: ${detail}`);
  }
}

/** Deterministic checklist failure — the patch itself is rejected. */
export class SecurityGateFailureError extends CriticError {
  /** Labels of the failed security checks (bounded, ≤ 6). */
  readonly labels: readonly string[];
  constructor(labels: readonly string[]) {
    const bounded = labels.slice(0, 6);
    super('PATCH_REJECTED', `security review failed: ${bounded.join(', ') || 'unknown'}`);
    this.labels = bounded;
  }
}

export class ValidationInfrastructureFailure extends CriticError {
  constructor(message: string) {
    super('VALIDATION_INFRASTRUCTURE_FAILURE', message);
  }
}