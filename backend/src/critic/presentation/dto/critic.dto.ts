/**
 * Critic API DTOs — zod-bounded request/response mapping. No free-form
 * input: patchId required, attempt optional ≤10. Responses expose run
 * ids + bounded status/checks only — never raw tool output, never secrets.
 */

import { z } from 'zod';
import type { CriticRunResult } from '../../domain/models/critic-result';

export const RunCriticRequestSchema = z.object({
  patchId: z.string().min(1).max(128),
  attempt: z.number().int().min(1).max(10).optional(),
});

export type RunCriticRequest = z.infer<typeof RunCriticRequestSchema>;

export function toCriticRunResponse(result: CriticRunResult) {
  return {
    id: result.id,
    patchId: result.patchId,
    vulnerabilityId: result.vulnerabilityId,
    scanId: result.scanId,
    executionId: result.executionId,
    attempt: result.attempt,
    status: result.status,
    failureKind: result.failureKind,
    checks: result.checks.map((c) => ({ name: c.name, status: c.status, durationMs: c.durationMs, detail: c.detail ?? null })),
    exploit: result.exploit
      ? {
          baseline: result.exploit.baseline.status,
          retest: result.exploit.retest.status,
          targetId: result.exploit.targetId,
        }
      : null,
    feedback: result.feedback
      ? {
          reason: result.feedback.reason,
          failedChecks: result.feedback.failedChecks,
          guidance: result.feedback.guidance,
        }
      : null,
    errorMessage: result.errorMessage,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
  };
}