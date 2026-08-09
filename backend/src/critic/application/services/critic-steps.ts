/**
 * CriticSteps — bounded executables that run INSIDE the disposable
 * validation sandbox. Each step owns its check entry + event emission and
 * only throws typed CriticErrors (failure classification lives in the
 * service). No step ever touches the original repository/workspace.
 */

import type { SniperService } from '../../../sniper/domain/ports/sniper-service';
import type { RuntimeSandboxService } from '../../../sandbox/domain/ports/runtime-sandbox-service';
import { toRuntimeContext } from '../../../sandbox/domain/entities/runtime-sandbox';
import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';
import type { CriticPatchContext } from '../../domain/ports/critic-finding-resolver';
import type { CriticEventSink } from '../../domain/events/critic-events';
import type { CriticEventName } from '../../domain/events/critic-events';
import type { CriticCheck, ExploitCriticOutcome } from '../../domain/models/critic-result';
import {
  ApplicationStartFailure,
  BaselineInvalidError,
  PatchConflictError,
  SandboxProvisionFailure,
  ValidationInfrastructureFailure,
} from '../../domain/errors/critic.errors';
import type { SandboxPatchApplier } from './patch-applier';
import type { CriticBuildCheck } from './build-check';
import { CriticRegressionTestRunner } from './test-runner';
import type { CriticSecurityReviewGate } from './security-review-gate';
import { CriticAdvisoryReviewer } from './llm-review';
import type { ReviewablePatch } from '../../domain/ports/patch-review-repository';
import { summarizeFinding } from './critic-outcome';

export interface CriticStepsConfig {
  readonly checkTimeoutMs: number;
  readonly testTimeoutMs: number;
  readonly retestTimeoutMs: number;
  readonly advisoryEnabled: boolean;
}

export interface CriticStepsDependencies {
  readonly runtimeService: RuntimeSandboxService;
  readonly sniper: SniperService;
  readonly applier: SandboxPatchApplier;
  readonly buildCheck: CriticBuildCheck;
  readonly testRunner: CriticRegressionTestRunner;
  readonly securityGate: CriticSecurityReviewGate;
  readonly llmReview: CriticAdvisoryReviewer;
  readonly events: CriticEventSink;
  readonly config: CriticStepsConfig;
}

export class CriticSteps {
  constructor(private readonly deps: CriticStepsDependencies) {}

  // ------------------------------------------------------------------------
  // provisioning + health
  // ------------------------------------------------------------------------

  async provisionFresh(scanId: string, runId: string): Promise<RuntimeSandboxContext> {
    this.emit('SANDBOX_PROVISIONING', runId, 'fresh validation sandbox');
    try {
      const fresh = await this.deps.runtimeService.create({
        scanId,
        repository: { name: 'critic-validation', url: undefined, path: undefined },
        hostExpose: true,
      });
      this.emit('SANDBOX_READY', runId, `fresh sandbox ${fresh.id} READY`);
      return toRuntimeContext(fresh);
    } catch (error) {
      throw new SandboxProvisionFailure(error instanceof Error ? error.message.slice(0, 300) : 'provision failed');
    }
  }

  async waitHealthy(scanId: string, sandbox: RuntimeSandboxContext): Promise<boolean> {
    try {
      const health = await this.deps.runtimeService.healthCheck(sandbox.id, { scanId });
      return health.ok;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // baseline — the fresh sandbox must reproduce the ORIGINAL exploit
  // -------------------------------------------------------------------------

  async runBaseline(
    scanId: string,
    context: CriticPatchContext,
    sandbox: RuntimeSandboxContext,
    checks: CriticCheck[],
    runId: string,
  ): Promise<'CONFIRMED' | 'NOT_CONFIRMED'> {
    this.emit('BASELINE_CHECK_STARTED', runId, context.finding.vulnerabilityId);
    let status: 'CONFIRMED' | 'NOT_CONFIRMED' = 'NOT_CONFIRMED';
    try {
      if (!(await this.waitReachable(scanId, sandbox, runId))) {
        checks.push({ name: 'baseline', status: 'FAILED', durationMs: 0, detail: 'fresh application not reachable' });
        return 'NOT_CONFIRMED';
      }
      const report = await this.deps.sniper.run({
        scanId,
        sandboxId: sandbox.sandboxId,
        baseUrl: sandbox.targetUrl,
        targetIds: [context.exploitTargetId],
        options: { timeoutMs: this.deps.config.retestTimeoutMs, persist: false },
      });
      status = report.results[0]?.exploit?.status === 'CONFIRMED' ? 'CONFIRMED' : 'NOT_CONFIRMED';
      checks.push({
        name: 'baseline',
        status: status === 'CONFIRMED' ? 'PASSED' : 'FAILED',
        durationMs: 0,
        detail: `baseline exploit → ${status}`,
      });
      return status;
    } catch (error) {
      checks.push({ name: 'baseline', status: 'ERROR', durationMs: 0, detail: 'baseline execution failed' });
      throw new ValidationInfrastructureFailure(error instanceof Error ? error.message.slice(0, 300) : 'baseline failed');
    } finally {
      this.emit('BASELINE_CHECK_COMPLETED', runId, status);
    }
  }

  private async waitReachable(scanId: string, sandbox: RuntimeSandboxContext, runId: string): Promise<boolean> {
    const ok = await this.waitHealthy(scanId, sandbox);
    if (!ok) {
      this.emit('BASELINE_CHECK_COMPLETED', runId, 'unreachable');
    }
    return ok;
  }

  // -------------------------------------------------------------------------
  // patch application (inside the disposable container only)
  // -------------------------------------------------------------------------

  async applyPatch(sandbox: RuntimeSandboxContext, patch: ReviewablePatch, checks: CriticCheck[], runId: string): Promise<void> {
    this.emit('PATCH_APPLY_STARTED', runId, patch.filePath ?? '');
    const applied = await this.deps.applier.apply(sandbox, patch);
    checks.push({
      name: 'patch-apply',
      status: 'PASSED',
      durationMs: 0,
      detail: `applied inside sandbox ${sandbox.sandboxId} (${applied.diffChars} diff chars)`,
    });
    this.emit('PATCH_APPLIED', runId, `applied → ${patch.filePath}`);
  }

  // -------------------------------------------------------------------------
  // build + regression tests
  // -------------------------------------------------------------------------

  async build(sandbox: RuntimeSandboxContext, filePath: string, checks: CriticCheck[], runId: string): Promise<void> {
    this.emit('BUILD_STARTED', runId, filePath);
    const result = await this.deps.buildCheck.run(sandbox, { filePath, timeoutMs: this.deps.config.checkTimeoutMs });
    checks.push({ name: 'build', status: toCheckStatus(result.status), durationMs: result.durationMs, detail: result.detail ?? '' });
    this.emit('BUILD_COMPLETED', runId, result.status);
    if (result.status === 'FAILED') {
      throw new BaselineInvalidError(`build failed: ${result.detail ?? ''}`);
    }
  }

  async tests(sandbox: RuntimeSandboxContext, checks: CriticCheck[], runId: string): Promise<void> {
    this.emit('TESTS_STARTED', runId, 'regression suite');
    const result = await this.deps.testRunner.run(sandbox, { timeoutMs: this.deps.config.testTimeoutMs });
    checks.push({ name: 'tests', status: toCheckStatus(result.status), durationMs: result.durationMs, detail: result.detail ?? '' });
    this.emit('TESTS_COMPLETED', runId, result.status);
    if (result.status === 'FAILED') {
      throw new PatchConflictError(`regression tests failed: ${result.detail ?? ''}`);
    }
  }

  // -------------------------------------------------------------------------
  // exploit re-verification (same target id as the original verification)
  // -------------------------------------------------------------------------

  async retest(
    scanId: string,
    context: CriticPatchContext,
    sandbox: RuntimeSandboxContext,
    baseline: 'CONFIRMED' | 'NOT_CONFIRMED',
    checks: CriticCheck[],
    runId: string,
  ): Promise<{ readonly verdict: 'FIXED' | 'SUCCEEDS' | 'INCONCLUSIVE'; readonly detail?: string; readonly exploit: ExploitCriticOutcome }> {
    this.emit('EXPLOIT_RETEST_STARTED', runId, context.exploitTargetId);
    const started = Date.now();
    try {
      const report = await this.deps.sniper.run({
        scanId,
        sandboxId: sandbox.sandboxId,
        baseUrl: sandbox.targetUrl,
        targetIds: [context.exploitTargetId],
        options: { timeoutMs: this.deps.config.retestTimeoutMs, persist: false },
      });
      const st = report.results[0]?.exploit?.status ?? 'NOT_TESTED';
      const verdict = st === 'NOT_CONFIRMED' ? 'FIXED' : st === 'CONFIRMED' ? 'SUCCEEDS' : 'INCONCLUSIVE';
      checks.push({
        name: 'exploit-retest',
        status: verdict === 'FIXED' ? 'PASSED' : verdict === 'SUCCEEDS' ? 'FAILED' : 'ERROR',
        durationMs: Date.now() - started,
        detail: `retest (${context.exploitTargetId}) → ${st}`,
      });
      this.emit('EXPLOIT_RETEST_COMPLETED', runId, st);
      return {
        verdict,
        detail: st,
        exploit: {
          baseline: { status: baseline },
          retest: {
            status: st === 'CONFIRMED' ? 'CONFIRMED' : st === 'NOT_CONFIRMED' ? 'NOT_CONFIRMED' : 'INCONCLUSIVE',
          },
          targetId: context.exploitTargetId,
        },
      };
    } catch (error) {
      checks.push({ name: 'exploit-retest', status: 'ERROR', durationMs: Date.now() - started, detail: 'retest execution failed' });
      throw new ValidationInfrastructureFailure(error instanceof Error ? error.message.slice(0, 300) : 'retest failed');
    }
  }

  // -------------------------------------------------------------------------
  // defense-in-depth: deterministic checklist + optional advisory LLM
  // -------------------------------------------------------------------------

  securityGate(filePath: string, diff: string): { readonly failedLabels: readonly string[]; readonly passed: boolean } {
    const gate = this.deps.securityGate.run({ filePath, diff });
    return {
      passed: gate.passed,
      failedLabels: gate.checks.filter((c) => !c.passed).map((c) => c.label),
    };
  }

  async advisory(patch: ReviewablePatch, context: CriticPatchContext, checks: CriticCheck[]): Promise<void> {
    if (!this.deps.config.advisoryEnabled) return;
    try {
      const advisory = await this.deps.llmReview.review({
        vulnerabilitySummary: summarizeFinding(
          context.finding.type,
          context.finding.status,
          context.finding.vulnerabilityId,
          context.finding.filePath ?? '',
          context.finding.lineNumber ?? null,
        ),
        filePath: patch.filePath!,
        diff: patch.diffContent!,
      });
      checks.push({
        name: 'security-review',
        status: 'PASSED',
        durationMs: 0,
        detail: advisory.concerns.length > 0 ? `advisory: ${advisory.concerns.join('; ').slice(0, 300)}` : 'advisory review: no concerns',
      });
    } catch {
      checks.push({ name: 'security-review', status: 'PASSED', durationMs: 0, detail: 'advisory review unavailable (degraded)' });
    }
  }


  /** Always-destroy the validation sandbox (idempotent, never throws). */
  async teardown(sandbox: RuntimeSandboxContext, runId: string): Promise<void> {
    this.emit('SANDBOX_DESTROYING', runId, sandbox.sandboxId);
    try {
      await this.deps.runtimeService.destroy(sandbox.id, { scanId: sandbox.scanId });
      this.emit('SANDBOX_DESTROYED', runId, 'validation sandbox destroyed');
    } catch (error) {
      this.emit('SANDBOX_DESTROYED', runId, `destroy reported error; logged, not fatal (${(error as Error)?.message?.slice(0, 100) ?? 'unknown'})`);
    }
  }

  private emit(name: CriticEventName, runId: string, detail?: string): void {
    this.deps.events.emit({ name, runId, recordedAt: new Date().toISOString(), detail: detail?.slice(0, 300) });
  }
}


function toCheckStatus(status: 'PASSED' | 'FAILED' | 'NOT_AVAILABLE'): CriticCheck['status'] {
  return status;
}