/**
 * Engineer outcome persistence (application layer). Centralises the strict
 * status transitions for a single run:
 *
 *   REJECTED (model declined)       → Patch row status=REJECTED
 *   review gate failed              → Patch row status=REJECTED (never GENERATED)
 *   review gate passed              → Patch row status=GENERATED
 *
 * plus AgentExecution recording (COMPLETED / FAILED). Neither path ever
 * applies a patch: the engineer writes artifacts only through the patch
 * repository port.
 */

import type { AgentExecutionDetail } from '../../../agent/application/services/agent-execution.service';
import type { RagResultDocument } from '../../../knowledge/application/services/rag.service';
import type { EngineerBounds, EngineerResponse } from '../../domain/models/engineer-response';
import type { ConfirmedVulnerabilityFinding } from '../../domain/ports/confirmed-finding-repository';
import type { EngineerPatchRecord } from '../../domain/ports/patch-repository';
import type { SourceReadResult } from '../../domain/ports/source-reader';
import { SecurityReviewGate } from './security-review-gate';
import type { EngineerRunStatus, EngineerDependencies } from './engineer.service';

export interface EngineerOutcomeCall {
  readonly response: EngineerResponse;
  readonly finding: ConfirmedVulnerabilityFinding;
  readonly sourceLines: number;
  readonly ragDocs: number;
}

export interface EngineerOutcome {
  readonly status: EngineerRunStatus;
  readonly patch: EngineerPatchRecord | null;
  readonly reason: string | null;
  readonly reviewPassed: boolean;
  readonly diffChars: number;
}

/** Run the deterministic security-review gate and persist the outcome row. */
export async function persistEngineerOutcome(
  deps: Pick<EngineerDependencies, 'patches'>,
  gate: SecurityReviewGate,
  call: EngineerOutcomeCall,
): Promise<EngineerOutcome> {
  let reason: string | null = null;

  if (call.response.status === 'REJECTED') {
    reason = call.response.reason ?? call.response.explanation;
    const patch = await deps.patches.saveGeneratedPatch({
      vulnerabilityId: call.response.vulnerabilityId,
      status: 'REJECTED',
      filePath: null,
      diffContent: null,
      explanation: reason,
      validatedAt: null,
    });
    return { status: 'REJECTED', patch, reason, reviewPassed: false, diffChars: 0 };
  }

  const gateResult = await gate.run({
    response: call.response,
    finding: call.finding,
    sourceRead: call.sourceLines > 0,
    ragDocsUsed: call.ragDocs,
  });

  if (!gateResult.passed) {
    const details = gateResult.checks
      .filter((c) => !c.passed)
      .map((c) => c.label)
      .join('; ');
    const patch = await deps.patches.saveGeneratedPatch({
      vulnerabilityId: call.response.vulnerabilityId,
      status: 'REJECTED',
      filePath: null,
      diffContent: null,
      explanation: `Security review rejected the generated patch: ${details}`,
      validatedAt: null,
    });
    return { status: 'REJECTED', patch, reason: `security review failed: ${details}`, reviewPassed: false, diffChars: 0 };
  }

  const patch = await deps.patches.saveGeneratedPatch({
    vulnerabilityId: call.response.vulnerabilityId,
    status: 'GENERATED',
    filePath: call.response.filePath,
    diffContent: call.response.diff,
    explanation: call.response.explanation,
    validatedAt: null,
  });
  return {
    status: 'GENERATED',
    patch,
    reason: null,
    reviewPassed: true,
    diffChars: (patch.diffContent ?? '').length,
  };
}

export interface ExecutionRecordCall {
  readonly scanId: string;
  readonly finding: ConfirmedVulnerabilityFinding;
  readonly loom: EngineerRunStatus;
  readonly model: string;
  readonly outcome: EngineerOutcome;
  readonly ragDocs: number;
  readonly startedAt: string;
}

/** Record the COMPLETED AgentExecution (metadata is bounded + sanitised). */
export async function recordEngineerExecution(
  deps: Pick<EngineerDependencies, 'executions'>,
  call: ExecutionRecordCall,
): Promise<AgentExecutionDetail> {
  return deps.executions.record({
    scanId: call.scanId,
    agentType: 'ENGINEER',
    status: 'COMPLETED',
    inputMetadata: {
      scanId: call.scanId,
      vulnerabilityId: call.finding.vulnerabilityId,
      vulnerabilityType: call.finding.type,
      severity: call.finding.severity,
      ragDocs: call.ragDocs,
    },
    outputMetadata: {
      status: call.loom,
      patchId: call.outcome.patch ? call.outcome.patch.id : null,
      filePath: call.outcome.patch?.filePath ?? null,
      diffChars: call.outcome.diffChars,
      model: call.model,
      reviewPassed: call.outcome.reviewPassed,
    },
    startedAt: call.startedAt,
    completedAt: new Date().toISOString(),
  });
}

/** Record a FAILED execution with a bounded, redactable message. */
export async function recordEngineerFailure(
  deps: Pick<EngineerDependencies, 'executions'>,
  scanId: string,
  vulnerabilityId: string | null,
  startedAt: Date,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 2_000) : 'unknown error';
  await deps.executions.record({
    scanId,
    agentType: 'ENGINEER',
    status: 'FAILED',
    inputMetadata: { scanId, vulnerabilityId },
    outputMetadata: { failed: true },
    errorMessage: message,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
  });
}