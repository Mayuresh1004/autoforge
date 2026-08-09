/**
 * Critic Agent domain model — bounded statuses and structured check results.
 * No arbitrary strings: statuses are typed unions; every check carries a
 * bounded outcome, duration and (optionally) a short error.
 */

/** Final Critic verdict for one run over one patch. */
export type CriticStatus = 'APPROVED' | 'REJECTED' | 'FAILED';

export const CRITIC_STATUSES: readonly CriticStatus[] = ['APPROVED', 'REJECTED', 'FAILED'];

export function isCriticStatus(value: unknown): value is CriticStatus {
  return value === 'APPROVED' || value === 'REJECTED' || value === 'FAILED';
}

/**
 * Fine-grained failure classification — infrastructure problems are NEVER
 * reported as "bad patch": a REJECTED patch means the patch itself failed
 * validation; FAILED means the validation environment did.
 */
export type CriticFailureKind =
  | 'PATCH_REJECTED'
  | 'VALIDATION_INFRASTRUCTURE_FAILURE'
  | 'BASELINE_INVALID'
  | 'SANDBOX_PROVISION_FAILURE'
  | 'APPLICATION_START_FAILURE'
  | 'EXPLOIT_STILL_SUCCEEDS';

export const CRITIC_FAILURE_KINDS: readonly CriticFailureKind[] = [
  'PATCH_REJECTED',
  'VALIDATION_INFRASTRUCTURE_FAILURE',
  'BASELINE_INVALID',
  'SANDBOX_PROVISION_FAILURE',
  'APPLICATION_START_FAILURE',
  'EXPLOIT_STILL_SUCCEEDS',
];

/** Ordered validation checks run inside the disposable sandbox. */
export type CriticCheckName =
  | 'baseline'
  | 'patch-apply'
  | 'application-startup'
  | 'build'
  | 'tests'
  | 'exploit-retest'
  | 'security-review';

export const CRITIC_CHECK_ORDER: readonly CriticCheckName[] = [
  'baseline',
  'patch-apply',
  'application-startup',
  'build',
  'tests',
  'exploit-retest',
  'security-review',
];

export type CriticCheckStatus = 'PASSED' | 'FAILED' | 'NOT_AVAILABLE' | 'SKIPPED' | 'ERROR';

export interface CriticCheck {
  readonly name: CriticCheckName;
  readonly status: CriticCheckStatus;
  /** Duration in ms (0 when not run). */
  readonly durationMs: number;
  /** Bounded short detail (≤ 500 chars), never raw output. */
  readonly detail?: string;
  /** Optional machine-readable code when failed. */
  readonly code?: string | null;
}

/** Original exploit re-verification (baseline + retest on the same target). */
export interface ExploitCriticOutcome {
  readonly baseline: {
    readonly status: 'CONFIRMED' | 'NOT_CONFIRMED' | 'INCONCLUSIVE' | 'FAILED';
    readonly reason?: string | null;
  };
  readonly retest: {
    readonly status: 'CONFIRMED' | 'NOT_CONFIRMED' | 'INCONCLUSIVE' | 'FAILED' | 'NOT_TESTED';
    readonly reason?: string | null;
  };
  readonly targetId: string;
}

/** Structured feedback handed back to the Engineer on rejection. */
export interface CriticFeedback {
  readonly reason: CriticFailureKind;
  readonly failedChecks: readonly string[];
  /** Bounded, human-readable guidance for the next Engineer attempt. */
  readonly guidance: string;
  /** Bounded evidence digest (sanitized; no secrets, no raw output). */
  readonly evidence: ReadonlyArray<{ readonly key: string; readonly detail: string }>;
}

/** Full run result — the single source of truth for persistence + API. */
export interface CriticRunResult {
  readonly id: string;
  readonly patchId: string;
  readonly vulnerabilityId: string;
  readonly scanId: string;
  readonly executionId: string | null;
  readonly attempt: number;
  readonly status: CriticStatus;
  readonly failureKind: CriticFailureKind | null;
  /** Bounded failure message when FAILED (never raw output). */
  readonly errorMessage: string | null;
  readonly checks: readonly CriticCheck[];
  readonly exploit: ExploitCriticOutcome | null;
  readonly feedback: CriticFeedback | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}