/**
 * Critic outcome classification + persistence. All verdicts flow through
 * ONE racy-proof path: REJECTED always means "the patch failed validation"
 * and carries structured feedback for the Engineer retry loop; FAILED always
 * means "the validation environment broke" and carries no feedback.
 */

import type { CriticRepository, SaveCriticRunInput } from '../../domain/ports/critic-repository';
import type { AgentExecutionService } from '../../../agent/application/services/agent-execution.service';
import type {
  CriticCheck,
  CriticFeedback,
  CriticFailureKind,
  CriticRunResult,
  ExploitCriticOutcome,
} from '../../domain/models/critic-result';
import {
  ApplicationStartFailure,
  BaselineInvalidError,
  ExploitInconclusiveError,
  ExploitStillSucceedsError,
  PatchConflictError,
  SandboxProvisionFailure,
  SecurityGateFailureError,
  ValidationInfrastructureFailure,
} from '../../domain/errors/critic.errors';

export type VerdictOutcome = 'APPROVED' | 'REJECTED' | 'FAILED';

export interface OutcomeInput {
  readonly patchId: string;
  readonly vulnerabilityId: string;
  readonly scanId: string;
  readonly attempt: number;
  readonly status: VerdictOutcome;
  readonly failureKind: CriticFailureKind | null;
  readonly checks: readonly CriticCheck[];
  readonly exploit: ExploitCriticOutcome | null;
  readonly feedback: CriticFeedback | null;
  readonly errorMessage: string | null;
  readonly startedAt: Date;
  readonly completedAt: Date;
}

/** In-memory event hook for rejection transitions (wired by the service). */
export type VerdictHook = (status: 'REJECTED', failureKind: CriticFailureKind) => void;

export class CriticOutcomeWriter {
  constructor(
    private readonly results: CriticRepository,
    private readonly executions: AgentExecutionService,
  ) {}

  async persist(input: OutcomeInput, onRejected?: VerdictHook): Promise<CriticRunResult> {
    if (input.status === 'REJECTED' && input.failureKind) {
      onRejected?.('REJECTED', input.failureKind);
    }
    const execution = await this.executions.record({
      scanId: input.scanId,
      agentType: 'CRITIC',
      status: input.status === 'FAILED' ? 'FAILED' : 'COMPLETED',
      startedAt: input.startedAt.toISOString(),
      completedAt: input.completedAt.toISOString(),
      errorMessage: input.errorMessage?.slice(0, 2_000) ?? null,
      inputMetadata: {
        patchId: input.patchId,
        vulnerabilityId: input.vulnerabilityId,
        attempt: input.attempt,
      },
      outputMetadata: {
        status: input.status,
        failureKind: input.failureKind ?? null,
        checks: input.checks.map((c) => `${c.name}:${c.status}`).slice(-8),
        retest: input.exploit?.retest?.status ?? null,
      },
    });

    const draft: SaveCriticRunInput = {
      patchId: input.patchId,
      vulnerabilityId: input.vulnerabilityId,
      scanId: input.scanId,
      executionId: execution.id,
      attempt: input.attempt,
      status: input.status,
      failureKind: input.failureKind,
      checks: input.checks,
      exploit: input.exploit,
      feedback: input.feedback,
      errorMessage: input.errorMessage,
      startedAt: input.startedAt.toISOString(),
      completedAt: input.completedAt.toISOString(),
    };
    return this.results.save(draft);
  }
}

/** Classify a thrown error into a verdict + failure kind + optional feedback. */
export function classifyFailure(error: unknown): {
  readonly status: 'APPROVED' | 'REJECTED' | 'FAILED';
  readonly failureKind: CriticFailureKind | null;
  readonly feedback: CriticFeedback | null;
  readonly errorMessage: string | null;
} {
  const message = error instanceof Error ? error.message.slice(0, 300) : 'validation failed';

  if (error instanceof ExploitStillSucceedsError) {
    return {
      status: 'REJECTED',
      failureKind: 'EXPLOIT_STILL_SUCCEEDS',
      feedback: makeFeedback('EXPLOIT_STILL_SUCCEEDS', ['exploit-retest'], message),
      errorMessage: message,
    };
  }
  if (error instanceof SecurityGateFailureError) {
    return {
      status: 'REJECTED',
      failureKind: 'PATCH_REJECTED',
      feedback: makeFeedback('PATCH_REJECTED', ['security-review', ...error.labels], message),
      errorMessage: message,
    };
  }
  if (error instanceof PatchConflictError) {
    return {
      status: 'REJECTED',
      failureKind: 'PATCH_REJECTED',
      feedback: makeFeedback('PATCH_REJECTED', ['build', 'tests'], message),
      errorMessage: message,
    };
  }
  if (error instanceof BaselineInvalidError) {
    return { status: 'FAILED', failureKind: 'BASELINE_INVALID', feedback: null, errorMessage: message };
  }
  if (error instanceof ApplicationStartFailure) {
    return { status: 'FAILED', failureKind: 'APPLICATION_START_FAILURE', feedback: null, errorMessage: message };
  }
  if (error instanceof SandboxProvisionFailure) {
    return { status: 'FAILED', failureKind: 'SANDBOX_PROVISION_FAILURE', feedback: null, errorMessage: message };
  }
  if (error instanceof ExploitInconclusiveError) {
    return { status: 'FAILED', failureKind: 'VALIDATION_INFRASTRUCTURE_FAILURE', feedback: null, errorMessage: message };
  }
  if (error instanceof ValidationInfrastructureFailure) {
    return { status: 'FAILED', failureKind: 'VALIDATION_INFRASTRUCTURE_FAILURE', feedback: null, errorMessage: message };
  }
  return { status: 'FAILED', failureKind: 'VALIDATION_INFRASTRUCTURE_FAILURE', feedback: null, errorMessage: message };
}

export function makeFeedback(
  reason: CriticFailureKind,
  failedChecks: readonly string[],
  guidance: string,
): CriticFeedback {
  return {
    reason,
    failedChecks: failedChecks.slice(0, 6),
    guidance: guidance.slice(0, 400),
    evidence: [],
  };
}

export function summarizeFinding(
  type: string,
  status: string,
  vulnerabilityId: string,
  filePath: string,
  line: number | null,
): string {
  return `${type} ${vulnerabilityId} (${status}) at ${filePath}${line ? `:${line}` : ''}`.slice(0, 500);
}