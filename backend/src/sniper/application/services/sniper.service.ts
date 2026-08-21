import { randomUUID } from 'node:crypto';
import { logger } from '../../../config/logger';
import type { SandboxManager } from '../../../sandbox/domain/ports/sandbox-manager';
import type { SniperConfig } from '../../../config';
import type { AmassEventPublisher, AmassEventInput } from '../../../observability/domain/ports/event-bus';
import type { ExploitResultDetail, ProofOfConcept } from '../../domain/models/verification';
import type { SniperRepository } from '../../domain/ports/sniper-repository';
import type { VerifierRegistry } from '../../domain/ports/vulnerability-verifier';
import type {
  RunSniperInput,
  SniperRunReport,
  SniperService,
  TargetRunOutcome,
} from '../../domain/ports/sniper-service';
import {
  SandboxMismatchError,
  SandboxUnavailableError,
} from '../../domain/errors/sniper.errors';
import { BoundedExecutor } from './bounded-executor';
import { SniperTargetRunner } from './sniper-run';
import { SandboxToolRuntime } from '../../infrastructure/tools/sandbox-tool-runtime';

export interface SniperServiceDeps {
  readonly repository: SniperRepository;
  readonly manager: SandboxManager;
  readonly verifiers: VerifierRegistry;
  readonly config: SniperConfig;
  /** Phase 9 observability publisher (default: silent). */
  readonly events?: AmassEventPublisher;
  readonly rag?: import('../../../knowledge/application/services/rag.service').RagService;
}

/**
 * Sniper Agent orchestration (facade). Assembles a bounded run over every
 * requested planned target and exposes read-back queries for the results.
 *
 * Per-target validation, verification and persistence live in
 * `SniperTargetRunner` (same-origin, auth gating, bounded attempts); the
 * bounded retry loop lives in `AttemptLoop`. This service only coordinates:
 * sandbox pre-flight → parallel bounded targets → per-target outcome
 * isolation → run report. Deterministic end-to-end (no LLM).
 */
export class DefaultSniperService implements SniperService {
  constructor(private readonly deps: SniperServiceDeps) {}

  async run(input: RunSniperInput): Promise<SniperRunReport> {
    const runId = `snip_${randomUUID().slice(0, 12)}`;
    const startedAt = Date.now();

    logger.info(
      {
        runId,
        scanId: input.scanId,
        sandboxId: input.sandboxId,
        targets: input.targetIds.length,
      },
      'sniper.run: started'
    );

    // Pre-flight: reject a run whose sandbox is missing or scan-mismatched.
    await this.validateSandbox(input);

    this.emit(input, {
      eventType: 'SNIPER_STARTED',
      agentType: 'SNIPER',
      phase: 'verification',
      status: 'STARTED',
      message: `verifying ${input.targetIds.length} planned target(s)`,
      metadata: { counts: { targets: input.targetIds.length } },
    });

    const findings = await this.deps.repository.loadFindings(input.scanId);
    const concurrency = Math.max(1, input.options?.concurrency ?? this.deps.config.concurrency);
    const executor = new BoundedExecutor(concurrency);
    // One sandbox-bound runtime; every exploit command stays inside it.
    const runtime = new SandboxToolRuntime(this.deps.manager, input.sandboxId);
    const runner = new SniperTargetRunner({
      repository: this.deps.repository,
      verifiers: this.deps.verifiers,
      config: this.deps.config,
      events: this.deps.events,
      rag: this.deps.rag,
    });

    const outcomes = await executor.runAll(
      input.targetIds.map(
        (targetId) => (): Promise<TargetRunOutcome> =>
          runner.runTarget(input, targetId, findings, runtime)
      )
    );

    const results = outcomes.map((o) => {
      if (o.ok) return o.value;
      return panicRecord(input, o.error);
    });

    logger.info(
      {
        runId,
        scanId: input.scanId,
        results: results.length,
        completed: results.filter((r) => r.exploit.status !== 'FAILED').length,
        durationMs: Date.now() - startedAt,
      },
      'sniper.run: complete'
    );

    this.emit(input, {
      eventType: 'SNIPER_VERIFICATION_COMPLETED',
      agentType: 'SNIPER',
      phase: 'verification',
      status: 'COMPLETED',
      message: `verification finished with ${results.length} result(s)`,
      metadata: {
        counts: {
          results: results.length,
          confirmed: results.filter((r) => r.exploit.status === 'CONFIRMED').length,
          failed: results.filter((r) => r.exploit.status === 'FAILED').length,
        },
      },
    });

    return {
      runId,
      scanId: input.scanId,
      sandboxId: input.sandboxId,
      results,
      completed: results.length,
      total: results.length,
    };
  }

  async getExploit(id: string): Promise<ProofOfConcept | null> {
    return this.deps.repository.getExploit(id);
  }

  async getExploitResults(id: string): Promise<ExploitResultDetail | null> {
    const exploit = await this.deps.repository.getExploit(id);
    if (!exploit) return null;
    const attempts = await this.deps.repository.listAttempts(id);
    return { exploit, attempts };
  }

  async listExploitsForTarget(targetId: string): Promise<readonly ProofOfConcept[]> {
    return this.deps.repository.listExploitsByTarget(targetId);
  }

  private emit(
    input: RunSniperInput,
    event: Omit<AmassEventInput, 'scanId'>,
  ): void {
    if (!this.deps.events) return;
    try {
      this.deps.events.publish({ ...event, scanId: input.scanId });
    } catch (error) {
      logger.warn({ err: error }, 'sniper.events: publish ignored');
    }
  }

  private async validateSandbox(input: RunSniperInput): Promise<void> {
    const sandbox = await this.deps.manager.getSandbox(input.sandboxId);
    if (!sandbox) throw new SandboxUnavailableError(input.sandboxId);
    if (sandbox.scanId !== input.scanId) {
      throw new SandboxMismatchError(input.sandboxId, 'scan', input.scanId, sandbox.scanId);
    }
  }
}

/** Executor-level failure record (should practically never surface). */
function panicRecord(input: RunSniperInput, error: unknown): TargetRunOutcome {
  return {
    targetId: 'unknown',
    exploit: {
      id: 'panic',
      targetId: 'unknown',
      scanId: input.scanId,
      vulnerabilityId: null,
      type: 'SQL_INJECTION',
      status: 'FAILED',
      confidence: null,
      confidenceBreakdown: null,
      endpoint: '',
      method: 'GET',
      parameter: null,
      verifier: '',
      tool: null,
      reason: `unexpected executor failure: ${messageOf(error)}`,
      evidence: [],
      attacks: 0,
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationMs: null,
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}