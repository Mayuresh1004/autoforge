/**
 * CriticService — Phase 8 orchestrator. Validates ONE Engineer-generated
 * patch of a CONFIRMED SQL_INJECTION inside a FRESH disposable sandbox:
 *
 *   provision → baseline → apply → startup → build → regression tests
 *   → exploit retest → security gate → (advisory LLM) → APPROVED | REJECTED.
 *
 * Contract:
 *  - the ORIGINAL repository/workspace is never touched (fresh sandbox only)
 *  - teardown is unconditional (finally): the validation sandbox is ALWAYS
 *    destroyed, even when validation crashes
 *  - infrastructure problems surface as FAILED, never REJECTED
 *  - the retest verdict can never be overridden by an optional LLM review
 */

import type { CriticFindingResolver } from '../../domain/ports/critic-finding-resolver';
import type { CriticPatchContext } from '../../domain/ports/critic-finding-resolver';
import type { CriticRepository } from '../../domain/ports/critic-repository';
import type { PatchReviewRepository } from '../../domain/ports/patch-review-repository';
import type { ReviewablePatch } from '../../domain/ports/patch-review-repository';
import type { CriticEventSink } from '../../domain/events/critic-events';
import type { CriticEventName } from '../../domain/events/critic-events';
import type { AmassEventPublisher, AmassEventInput } from '../../../observability/domain/ports/event-bus';
import type {
  CriticCheck,
  CriticFailureKind,
  CriticFeedback,
  CriticRunResult,
  ExploitCriticOutcome,
} from '../../domain/models/critic-result';
import {
  ApplicationStartFailure,
  BaselineInvalidError,
  ExploitInconclusiveError,
  ExploitStillSucceedsError,
  InvalidPatchStatusError,
  PatchConflictError,
  PatchNotFoundError,
  SecurityGateFailureError,
  UnsupportedVulnerabilityError,
} from '../../domain/errors/critic.errors';
import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';
import { logger } from '../../../config/logger';
import { CriticSteps } from './critic-steps';
import { CriticOutcomeWriter, classifyFailure } from './critic-outcome';

export interface CriticRunInput {
  readonly patchId: string;
  /** Attempt ordinal (1 = first). The loop increments. */
  readonly attempt?: number;
}

export interface CriticConfig {
  readonly maxPatchBytes: number;
  readonly maxSourceBytes: number;
  readonly checkTimeoutMs: number;
  readonly testTimeoutMs: number;
  readonly retestTimeoutMs: number;
  readonly advisoryEnabled: boolean;
}

export interface CriticDependencies {
  readonly patches: PatchReviewRepository;
  readonly findings: CriticFindingResolver;
  /** The ONLY lifecycle seam (existing RuntimeSandboxService, via steps). */
  readonly steps: CriticSteps;
  readonly events: CriticEventSink;
  readonly outcomes: CriticOutcomeWriter;
  readonly results: CriticRepository;
  /** Phase 9 canonical event bus (optional). */
  readonly eventsBridge?: AmassEventPublisher;
}

export interface CriticService {
  run(input: CriticRunInput): Promise<CriticRunResult>;
  /** Look up a run by its recorded execution id. */
  getRun(executionId: string): Promise<CriticRunResult | null>;
}

export class DefaultCriticService implements CriticService {
  constructor(private readonly deps: CriticDependencies) {}

  async run(input: CriticRunInput): Promise<CriticRunResult> {
    const startedAt = new Date();
    const attempt = input.attempt ?? 1;
    // ---- gate 1: only GENERATED patches on CONFIRMED SQLI findings -----
    const patch = await this.deps.patches.getPatch(input.patchId);
    if (!patch) throw new PatchNotFoundError(input.patchId);
    if (patch.status !== 'GENERATED') throw new InvalidPatchStatusError(input.patchId, patch.status);

    const context = await this.deps.findings.resolveForPatch(input.patchId);
    if (!context) throw new UnsupportedVulnerabilityError(input.patchId, 'n/a', 'n/a');
    if (context.finding.status !== 'CONFIRMED' || context.finding.type !== 'SQL_INJECTION') {
      throw new UnsupportedVulnerabilityError(input.patchId, context.finding.status, context.finding.type);
    }
    if (!patch.filePath || !patch.diffContent) {
      throw new PatchConflictError('patch has no file content to validate');
    }

    await this.deps.patches.markUnderReview(patch.id);
    return this.validate(input, context, patch, attempt, startedAt);
  }

  async getRun(executionId: string): Promise<CriticRunResult | null> {
    return this.deps.results.getByExecutionId(executionId.trim());
  }

  // -------------------------------------------------------------------------
  // Main validation body — one disposable sandbox per call.
  // -------------------------------------------------------------------------

  private async validate(
    input: CriticRunInput,
    context: CriticPatchContext,
    patch: ReviewablePatch,
    attempt: number,
    startedAt: Date,
  ): Promise<CriticRunResult> {
    const { scanId } = context.finding;
    const runId = `${patch.id}#${attempt}`;
    const checks: CriticCheck[] = [];
    let sandbox: RuntimeSandboxContext | null = null;
    let exploit: ExploitCriticOutcome | null = null;
    try {
      this.bridge(scanId, {
        eventType: 'CRITIC_STARTED',
        agentType: 'CRITIC',
        phase: 'validation',
        status: 'STARTED',
        message: `critic validation of patch ${patch.id} (attempt ${attempt})`,
        metadata: { patchId: patch.id, vulnerabilityId: context.finding.vulnerabilityId, counts: { attempt } },
      });
      sandbox = await this.deps.steps.provisionFresh(scanId, runId);

      this.bridge(scanId, {
        eventType: 'BASELINE_CHECK_STARTED',
        agentType: 'CRITIC',
        phase: 'validation',
        status: 'STARTED',
        message: 'reproducing the exploit baseline in the fresh sandbox',
        metadata: { vulnerabilityId: context.finding.vulnerabilityId },
      });
      const baseline = await this.deps.steps.runBaseline(scanId, context, sandbox, checks, runId);
      this.bridge(scanId, {
        eventType: 'BASELINE_CHECK_COMPLETED',
        agentType: 'CRITIC',
        phase: 'validation',
        status: 'COMPLETED',
        message: baseline === 'CONFIRMED' ? 'baseline reproduces' : 'baseline differs',
        metadata: { vulnerabilityId: context.finding.vulnerabilityId, result: baseline },
      });
      if (baseline !== 'CONFIRMED') {
        throw new BaselineInvalidError('offending exploit is not reproducible in the fresh sandbox');
      }

      this.bridge(scanId, {
        eventType: 'PATCH_APPLY_STARTED',
        agentType: 'CRITIC',
        phase: 'validation',
        status: 'STARTED',
        message: `applying patch ${patch.id}`,
        metadata: { patchId: patch.id, filePath: patch.filePath ?? undefined },
      });
      await this.deps.steps.applyPatch(sandbox, patch, checks, runId);
      this.bridge(scanId, {
        eventType: 'PATCH_APPLIED',
        agentType: 'CRITIC',
        phase: 'validation',
        status: 'SUCCEEDED',
        message: `patch ${patch.id} applied`,
        metadata: { patchId: patch.id, filePath: patch.filePath ?? undefined },
      });

      if (!(await this.deps.steps.waitHealthy(scanId, sandbox))) {
        throw new ApplicationStartFailure('application did not become healthy after patch');
      }
      checks.push({ name: 'application-startup', status: 'PASSED', durationMs: 0, detail: 'health check ok' });

      this.bridge(scanId, {
        eventType: 'BUILD_STARTED',
        agentType: 'CRITIC',
        phase: 'validation',
        status: 'STARTED',
        message: 'building patched application',
        metadata: { patchId: patch.id },
      });
      await this.deps.steps.build(sandbox, patch.filePath!, checks, runId);
      this.bridge(scanId, {
        eventType: 'BUILD_COMPLETED',
        agentType: 'CRITIC',
        phase: 'validation',
        status: 'COMPLETED',
        message: 'build passed',
        metadata: { check: 'build' },
      });

      this.bridge(scanId, {
        eventType: 'TESTS_STARTED',
        agentType: 'CRITIC',
        phase: 'validation',
        status: 'STARTED',
        message: 'running regression tests',
        metadata: { check: 'tests' },
      });
      await this.deps.steps.tests(sandbox, checks, runId);
      this.bridge(scanId, {
        eventType: 'TESTS_COMPLETED',
        agentType: 'CRITIC',
        phase: 'validation',
        status: 'COMPLETED',
        message: 'tests passed',
        metadata: { check: 'tests' },
      });

      this.bridge(scanId, {
        eventType: 'EXPLOIT_RETEST_STARTED',
        agentType: 'CRITIC',
        phase: 'validation',
        status: 'STARTED',
        message: 're-attempting the exploit after the patch',
        metadata: { patchId: patch.id },
      });
      const retest = await this.deps.steps.retest(scanId, context, sandbox, baseline, checks, runId);
      exploit = retest.exploit;
      this.bridge(scanId, {
        eventType: 'EXPLOIT_RETEST_COMPLETED',
        agentType: 'CRITIC',
        phase: 'validation',
        status: 'COMPLETED',
        message: `retest verdict: ${retest.verdict}`,
        metadata: { patchId: patch.id, result: retest.verdict },
      });
      if (retest.verdict === 'SUCCEEDS') {
        throw new ExploitStillSucceedsError('the original SQL injection is still confirmed after the patch');
      }
      if (retest.verdict === 'INCONCLUSIVE') {
        throw new ExploitInconclusiveError(`retest did not conclude (${retest.detail ?? 'no verifier verdict'})`);
      }

      const gate = this.deps.steps.securityGate(patch.filePath!, patch.diffContent!);
      checks.push({
        name: 'security-review',
        status: gate.passed ? 'PASSED' : 'FAILED',
        durationMs: 0,
        detail: gate.failedLabels.length ? gate.failedLabels.slice(0, 3).join(', ') : 'deterministic checklist ok',
      });
      if (!gate.passed) throw new SecurityGateFailureError(gate.failedLabels);

      await this.deps.steps.advisory(patch, context, checks);

      await this.deps.patches.setVerdict(patch.id, 'APPROVED');
      this.bridge(scanId, {
        eventType: 'CRITIC_APPROVED',
        agentType: 'CRITIC',
        phase: 'validation',
        status: 'SUCCEEDED',
        message: `patch ${patch.id} approved`,
        metadata: { patchId: patch.id, vulnerabilityId: context.finding.vulnerabilityId },
      });
      this.emit('CRITIC_APPROVED', runId, `patch ${patch.id} approved`);
      return this.persist('APPROVED', null, null, patch, context, attempt, startedAt, checks, exploit, null);
    } catch (error) {
      return this.failed(patch, context, attempt, startedAt, checks, exploit, error, runId);
    } finally {
      if (sandbox) {
        await this.deps.steps.teardown(sandbox, runId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Outcome + persistence
  // -------------------------------------------------------------------------

  private async persist(
    status: 'APPROVED' | 'REJECTED' | 'FAILED',
    failureKind: CriticFailureKind | null,
    feedback: CriticFeedback | null,
    patch: ReviewablePatch,
    context: CriticPatchContext,
    attempt: number,
    startedAt: Date,
    checks: CriticCheck[],
    exploit: ExploitCriticOutcome | null,
    errorMessage: string | null,
  ): Promise<CriticRunResult> {
    return this.deps.outcomes.persist({
      patchId: patch.id,
      vulnerabilityId: context.finding.vulnerabilityId,
      scanId: context.finding.scanId,
      attempt,
      status,
      failureKind,
      checks,
      exploit,
      feedback,
      errorMessage,
      startedAt,
      completedAt: new Date(),
    });
  }

  private async failed(
    patch: ReviewablePatch,
    context: CriticPatchContext,
    attempt: number,
    startedAt: Date,
    checks: CriticCheck[],
    exploit: ExploitCriticOutcome | null,
    error: unknown,
    runId: string,
  ): Promise<CriticRunResult> {
    const failure = classifyFailure(error);
    if (failure.status === 'REJECTED' && failure.failureKind) {
      await this.deps.patches.setVerdict(patch.id, 'REJECTED');
      this.bridge(context.finding.scanId, {
        eventType: 'CRITIC_REJECTED',
        agentType: 'CRITIC',
        phase: 'validation',
        status: 'REJECTED',
        message: `patch ${patch.id} rejected: ${failure.failureKind}`,
        metadata: { patchId: patch.id, check: failure.failureKind, result: 'REJECTED' },
      });
      this.emit('CRITIC_REJECTED', runId, failure.failureKind);
    } else {
      this.bridge(context.finding.scanId, {
        eventType: 'CRITIC_FAILED',
        agentType: 'CRITIC',
        phase: 'validation',
        level: 'ERROR',
        status: 'FAILED',
        message: `patch ${patch.id} failed validation`,
        metadata: { patchId: patch.id, check: failure.failureKind ?? undefined },
      });
    }
    return this.persist(
      failure.status,
      failure.failureKind,
      failure.status === 'REJECTED' ? failure.feedback : null,
      patch,
      context,
      attempt,
      startedAt,
      checks,
      exploit,
      failure.errorMessage,
    );
  }

  private bridge(scanId: string, input: Omit<AmassEventInput, 'scanId'>): void {
    if (!this.deps.eventsBridge) return;
    try {
      this.deps.eventsBridge.publish({ ...input, scanId });
    } catch (error) {
      logger.warn({ err: error }, 'critic.events: publish ignored');
    }
  }

  private emit(name: CriticEventName, runId: string, detail?: string): void {
    this.deps.events.emit({ name, runId, recordedAt: new Date().toISOString(), detail: detail?.slice(0, 300) });
  }
}