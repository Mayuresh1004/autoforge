import type { ExploitResultDetail, ProofOfConcept } from '../models/verification';
import type { SandboxCredentials } from '../models/verification';

/**
 * Sniper Agent input: which planned targets to verify, against which sandbox.
 * `baseUrl` is the target application's URL inside the sandbox — every check
 * stays same-origin with it.
 */
export interface RunSniperInput {
  readonly scanId: string;
  readonly sandboxId: string;
  /** Target application base URL inside the sandbox (same-origin scope). */
  readonly baseUrl: string;
  /** One or more planned target ids to verify. */
  readonly targetIds: readonly string[];
  /** Explicitly provided credentials (optional — never derived/guessed). */
  readonly credentials?: SandboxCredentials;
  readonly options?: {
    readonly timeoutMs?: number;
    readonly concurrency?: number;
    readonly maxAttempts?: number;
    /**
     * When false, verification still runs and returns the same PoC records
     * but NOTHING is written to the repository (no Exploit / Verification-
     * Attempt / Evidence rows). Used for non-destructive re-verification
     * (e.g. Critic baseline/retest) so agent checks never pollute scan data.
     * Default: true.
     */
    readonly persist?: boolean;
  };
}

/** One target's verification result inside a run report. */
export interface TargetRunOutcome {
  readonly targetId: string;
  readonly exploit: ProofOfConcept;
}

export interface SniperRunReport {
  readonly runId: string;
  readonly scanId: string;
  readonly sandboxId: string;
  readonly results: readonly TargetRunOutcome[];
  readonly completed: number;
  readonly total: number;
}

/**
 * Agent-facing Sniper service. Verifies planned targets inside the provided
 * sandbox and returns PoC records. Deterministic — no LLM inside.
 */
export interface SniperService {
  /** Verify all planned targets, bounded by configured concurrency. */
  run(input: RunSniperInput): Promise<SniperRunReport>;
  /** Final PoC record by exploit id. */
  getExploit(id: string): Promise<ProofOfConcept | null>;
  /** Final PoC + all verification attempts (review detail). */
  getExploitResults(id: string): Promise<ExploitResultDetail | null>;
  /** All exploits recorded for a planned target. */
  listExploitsForTarget(targetId: string): Promise<readonly ProofOfConcept[]>;
}