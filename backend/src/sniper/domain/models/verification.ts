import type { VulnerabilityType } from './vulnerability-type';

/**
 * Exploit verification states. Deliberately not a boolean: a tool that could
 * not run (FAILED) is different from one that ran cleanly and found nothing
 * (NOT_CONFIRMED), and missing prerequisites (NOT_TESTED / INCONCLUSIVE) are
 * explicit so reviewers never guess.
 */
export type VerificationStatus =
  | 'NOT_TESTED'
  | 'TESTING'
  | 'CONFIRMED'
  | 'NOT_CONFIRMED'
  | 'INCONCLUSIVE'
  | 'FAILED';

export const ALL_VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  'NOT_TESTED',
  'TESTING',
  'CONFIRMED',
  'NOT_CONFIRMED',
  'INCONCLUSIVE',
  'FAILED',
];

/** Evidence categories that feed the explainable confidence score. */
export type ConfidenceFactorCategory =
  | 'tool_confirmation'
  | 'reproducibility'
  | 'response_behavior'
  | 'static_correlation'
  | 'endpoint_reachability';

export const CONFIDENCE_FACTOR_CATEGORIES: readonly ConfidenceFactorCategory[] = [
  'tool_confirmation',
  'reproducibility',
  'response_behavior',
  'static_correlation',
  'endpoint_reachability',
];

/** One weighted evidence factor behind the confidence score. */
export interface ConfidenceFactor {
  readonly category: ConfidenceFactorCategory;
  /** 0..1 — strength of this signal. */
  readonly score: number;
  /** Why this signal scored as it did (human-reviewable). */
  readonly reason: string;
}

/** Explainable confidence: a weighted breakdown, never an LLM guess. */
export interface ConfidenceBreakdown {
  readonly score: number;
  readonly weighted: boolean;
  readonly factors: readonly ConfidenceFactor[];
}

/** Structured evidence item captured for a review. */
export interface EvidenceItem {
  /** Machine-readable indicator, e.g. `sqlmap:injection_point`. */
  readonly indicator: string;
  readonly category: EvidenceCategory;
  readonly httpStatus?: number;
  /** Short, redacted observation (never a full response body). */
  readonly detail?: string;
  /** 0..1 contribution toward confidence. */
  readonly confidenceFactor: number;
}

export type EvidenceCategory =
  | 'tool_confirmation'
  | 'reproducibility'
  | 'response_behavior'
  | 'static_correlation'
  | 'endpoint_reachability';

/** Static-scan correlated finding (input to scoring, never copied verbatim). */
export interface CorrelatedFinding {
  readonly id: string;
  readonly vulnType: string | null;
  readonly cwe: string | null;
  readonly confidence: number;
  readonly severity: string;
}

/**
 * What the Sniper asks a verifier to test. Pure request — no secrets, no
 * sandbox internals.
 */
export interface VerificationTarget {
  readonly targetId: string;
  readonly endpoint: string;
  readonly method: string;
  readonly type: VulnerabilityType;
  readonly requiresAuthentication: boolean;
  /** Safe to use only when explicitly supplied by the sandbox/test config. */
  readonly credentials?: SandboxCredentials;
  /** Secondary session/credentials for multi-tenant cross-user verification (User B). */
  readonly attackerCredentials?: SandboxCredentials;
  /** Structured verification hints from Planner (parameter names, upload fields, locations). */
  readonly verificationHints?: import('../../../planner/domain/models/plan').TargetVerificationHints;
}

/** Credentials allowed for verification. ONLY explicitly-provided values —
 * the Sniper never guesses, brute-forces or bypasses authentication. */
export interface SandboxCredentials {
  readonly username?: string;
  readonly password?: string;
  readonly cookie?: string;
  readonly header?: string;
  readonly sessionToken?: string;
}

/** Run context handed from the orchestration service to a verifier. */
export interface VerificationContext {
  readonly scanId: string;
  readonly sandboxId: string;
  /** Target app base URL (same-origin scope). */
  readonly baseUrl: string;
  readonly target: VerificationTarget;
  /** Execution seam bound to the sandbox (see domain/ports/tool-runtime). */
  readonly runtime: import('../ports/tool-runtime').ToolRuntime;
  readonly staticCorrelation?: {
    readonly hasFinding: boolean;
    readonly finding?: CorrelatedFinding;
  };
  readonly timeoutMs: number;
  readonly rag?: import('../../../knowledge/application/services/rag.service').RagService;
}

/** The verifier's deterministic verdict. */
export interface VerificationOutcome {
  readonly status: VerificationStatus;
  readonly confidence: ConfidenceBreakdown;
  readonly evidence: readonly EvidenceItem[];
  /** Verifier id that produced this outcome (e.g. `sql-injection`). */
  readonly verifier: string;
  /** Canonical tool name (e.g. `sqlmap`). */
  readonly tool: string;
  /** Redacted, truncated summary of tool output for reviewers. */
  readonly toolSummary: string;
  /** Redacted, truncated stderr summary (tool crashes, warnings). */
  readonly toolStderr: string;
  /** Identified injection parameter, when the tool pinpoints one. */
  readonly parameter?: string;
  /** Short human-readable reason for the status. */
  readonly reason: string;
  /** Human-readable indicator (e.g. `sqlmap:injection_point@query`). */
  readonly indicator?: string;
  /** True when a re-run may succeed but must not be retried blindly. */
  readonly retryable: boolean;
}

/** Final proof-of-concept record returned to the caller. */
export interface ProofOfConcept {
  readonly id: string;
  readonly targetId: string;
  readonly scanId: string;
  readonly vulnerabilityId: string | null;
  readonly type: VulnerabilityType;
  readonly status: VerificationStatus;
  readonly confidence: number | null;
  readonly confidenceBreakdown: ConfidenceBreakdown | null;
  readonly endpoint: string;
  readonly method: string;
  readonly parameter: string | null;
  readonly verifier: string;
  readonly tool: string | null;
  readonly reason: string;
  readonly evidence: readonly EvidenceItem[];
  readonly attacks: number;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
}

/** Detail view of one exploit: final status + all attempts (review). */
export interface ExploitResultDetail {
  readonly exploit: ProofOfConcept;
  readonly attempts: readonly AttemptRecord[];
}

/** Per-attempt record (a vulnerability may be verified multiple times). */
export interface AttemptRecord {
  readonly id: string;
  readonly exploitId: string;
  readonly attemptNumber: number;
  readonly verifier: string;
  readonly tool: string | null;
  readonly status: VerificationStatus;
  readonly stdout: string | null;
  readonly stderr: string | null;
  readonly errorMessage: string | null;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly retried: boolean;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
}