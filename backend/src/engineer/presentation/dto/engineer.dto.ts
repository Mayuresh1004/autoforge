/**
 * Engineer API DTOs — zod-bounded request/response mapping. No free-form
 * input: scanId is required, vulnerabilityId optional; all strings bounded.
 * Response shapes expose execution/patch ids + bounded summaries only —
 * never raw LLM text, never secrets.
 */

import { z } from 'zod';
import type { AgentExecutionDetail } from '../../../agent/application/services/agent-execution.service';
import type { EngineerRunResult } from '../../application/services/engineer.service';

export const RunEngineerRequestSchema = z.object({
  scanId: z.string().min(1).max(128),
  vulnerabilityId: z.string().min(1).max(128).optional(),
});

export type RunEngineerRequest = z.infer<typeof RunEngineerRequestSchema>;

export function toRunEngineerResponse(result: EngineerRunResult) {
  return {
    executionId: result.executionId,
    vulnerabilityId: result.vulnerabilityId,
    patchId: result.patchId,
    status: result.status,
    summary: {
      sourceLines: result.summary.sourceLines,
      ragDocs: result.summary.ragDocs,
      reviewPassed: result.summary.reviewPassed,
      model: result.summary.model,
      diffChars: result.summary.diffChars,
      reason: result.summary.reason,
    },
  };
}

export function toEngineerExecutionResponse(detail: AgentExecutionDetail) {
  return {
    id: detail.id,
    scanId: detail.scanId,
    agentType: detail.agentType,
    status: detail.status,
    createdAt: detail.createdAt,
    startedAt: detail.startedAt ?? null,
    completedAt: detail.completedAt ?? null,
    errorMessage: detail.errorMessage ?? null,
    // metadata is already sanitized at persist time (no keys/secrets)
    inputMetadata: detail.inputMetadata ?? null,
    outputMetadata: detail.outputMetadata ?? null,
  };
}