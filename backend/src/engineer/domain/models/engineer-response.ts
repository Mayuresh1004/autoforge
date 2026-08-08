/**
 * Strict application-level Engineer output schema. The LLM returns JSON; we
 * parse + structurally validate it HERE (never trust free-form text). Only a
 * validated instance may be persisted as a GENERATED patch.
 *
 * status is deliberately bounded:
 *  - GENERATED — the model produced a unified diff it believes mitigates the
 *    confirmed finding (still unverified security-wise — Critic's job later),
 *  - REJECTED — the model could not safely produce a patch (insufficient
 *    context); `reason` explains why.
 */

export type EngineerPatchStatus = 'GENERATED' | 'REJECTED';

/** Human-readable remediation strategy classes (advisory hint to the model). */
export const REMEDIATION_STRATEGY_HINTS = [
  'parameterized query',
  'prepared statement',
  'ORM parameter binding',
  'safe query API',
  'input validation boundary',
] as const;

export interface EngineerResponse {
  readonly vulnerabilityId: string;
  readonly status: EngineerPatchStatus;
  /** Relative repo path of the primary patched file (GENERATED only). */
  readonly filePath: string | null;
  /** Unified diff (GENERATED only). Empty for REJECTED. */
  readonly diff: string | null;
  /** Why the patch mitigates the vulnerability (REQUIRED). */
  readonly explanation: string;
  /** Short remediation strategy label (advisory). */
  readonly remediation: string;
  /** Explicit assumptions made while patching (optional). */
  readonly assumptions: readonly string[];
  /** For REJECTED: why a patch could not be produced. */
  readonly reason?: string | null;
}

/** Structural bounds applied by the validator + security gate. */
export interface EngineerBounds {
  readonly maxDiffChars: number;
  readonly maxPatchFiles: number;
  readonly maxExplanationChars: number;
  readonly maxAssumptions: number;
}

export const DEFAULT_ENGINEER_BOUNDS: EngineerBounds = {
  maxDiffChars: 16_000,
  maxPatchFiles: 3,
  maxExplanationChars: 1_200,
  maxAssumptions: 8,
};

export function isEngineerPatchStatus(value: unknown): value is EngineerPatchStatus {
  return value === 'GENERATED' || value === 'REJECTED';
}

/** Parse a JSON string (possibly fenced) into a plain object, or null. */
export function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}