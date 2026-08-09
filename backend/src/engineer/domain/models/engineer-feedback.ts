/**
 * Engineer feedback — bounded retry guidance produced by the Critic and
 * consumed by the Engineer's next attempt. Structurally mirrors the Critic
 * feedback record (same fields, no cross-module imports).
 */

export interface EngineerFeedback {
  /** Machine-readable rejection reason (CriticFailureKind string). */
  readonly reason: string;
  /** Bounded list of failed check labels (≤ 6). */
  readonly failedChecks: readonly string[];
  /** Bounded human guidance (≤ 400 chars) for the next attempt. */
  readonly guidance: string;
  /** Which retry attempt this feedback belongs to (1 = first retry). */
  readonly attempt: number;
}