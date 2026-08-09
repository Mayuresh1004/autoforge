/**
 * Critic patch-input port — the ONLY way the Critic reads a patch and
 * transitions its status. Implemented over the EXISTING Prisma `Patch`
 * model (no duplicate table). Status transitions are deterministic and
 * narrow:
 *
 *   GENERATED → UNDER_REVIEW → APPROVED | REJECTED
 *
 * Anything else (APPLIED / VALIDATED / already reviewed) is rejected by
 * the caller before any sandbox work happens.
 */

export type ReviewablePatchStatus = 'GENERATED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';

export interface ReviewablePatch {
  readonly id: string;
  readonly vulnerabilityId: string;
  readonly status: ReviewablePatchStatus;
  /** Repo-relative path of the patched file (null when no diff). */
  readonly filePath: string | null;
  /** Unified diff produced by the Engineer (never applied to the host). */
  readonly diffContent: string | null;
  readonly explanation: string | null;
  readonly createdAt: string;
}

export interface PatchReviewRepository {
  getPatch(patchId: string): Promise<ReviewablePatch | null>;
  /** Mark UNDER_REVIEW before validation starts (idempotent). */
  markUnderReview(patchId: string): Promise<void>;
  /** Final transition — APPROVED or REJECTED (terminal, idempotent). */
  setVerdict(patchId: string, verdict: 'APPROVED' | 'REJECTED'): Promise<void>;
}