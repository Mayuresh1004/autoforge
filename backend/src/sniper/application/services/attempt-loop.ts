/**
 * Bounded attempt loop for a single verification target. Owns:
 *   - the attempt count (hard cap),
 *   - retry gating (transient outcomes only; CONFIRMED / NOT_CONFIRMED /
 *     NOT_TESTED are terminal and never retried),
 *   - per-attempt persistence through the repository,
 *   - backoff delay + logging between attempts.
 *
 * Deterministic and bounded: at most `maxAttempts` attempts, each with its own
 * hard timeout owned by the verifier/caller — no infinite loops anywhere.
 */
import { logger } from '../../../config/logger';
import type { SniperConfig } from '../../../config';
import type {
  VerificationContext,
  VerificationOutcome,
  VerificationStatus,
} from '../../domain/models/verification';
import type { VulnerabilityType } from '../../domain/models/vulnerability-type';
import type { PlannedTargetSnapshot, SniperRepository } from '../../domain/ports/sniper-repository';
import type { RunSniperInput } from '../../domain/ports/sniper-service';
import type { VulnerabilityVerifier } from '../../domain/ports/vulnerability-verifier';

/** Everything the loop needs to run one target's attempts. */
export interface AttemptParts {
  readonly input: RunSniperInput;
  readonly planned: PlannedTargetSnapshot;
  readonly type: VulnerabilityType;
  readonly verifier: VulnerabilityVerifier;
  readonly context: VerificationContext;
  readonly exploitId: string;
  readonly maxAttempts: number;
  /** True when attempts must be persisted (default). False = dry-run check. */
  readonly persist: boolean;
}

/** Final-answer statuses — never retried, even if the classifier flags them. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'CONFIRMED',
  'NOT_CONFIRMED',
  'NOT_TESTED',
]);

export function retryAllowed(outcome: VerificationOutcome): boolean {
  if (TERMINAL_STATUSES.has(outcome.status)) return false;
  return outcome.retryable;
}

export class AttemptLoop {
  constructor(
    private readonly repository: SniperRepository,
    private readonly config: SniperConfig,
  ) {}

  /**
   * Run up to `maxAttempts` verifier calls, persisting each attempt and
   * stopping early on a terminal verdict. Returns the LAST outcome + count.
   */
  async run(parts: AttemptParts): Promise<{ outcome: VerificationOutcome; attempts: number }> {
    const { verifier, context, maxAttempts } = parts;

    let last: VerificationOutcome = failedOutcome('verification did not complete');
    let attempts = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      const attemptStarted = Date.now();
      const outcome = await this.singleAttempt(verifier, context, attempt);
      const durationMs = Date.now() - attemptStarted;

      if (parts.persist) {
        await this.persistAttempt(parts, outcome, attempt, durationMs, attemptStarted);
      }
      last = outcome;

      logger.info(
        {
          scanId: parts.input.scanId,
          targetId: parts.planned.targetId,
          vulnerabilityType: parts.type,
          verifier: verifier.id,
          attempt,
          status: outcome.status,
          durationMs,
        },
        retryAllowed(outcome) && attempt < maxAttempts
          ? 'sniper.attempt: retrying'
          : 'sniper.attempt: done'
      );

      if (!retryAllowed(outcome)) break;
      if (attempt >= maxAttempts) break;
      await sleep(this.config.retryDelayMs);
    }

    return { outcome: last, attempts };
  }

  private async singleAttempt(
    verifier: VulnerabilityVerifier,
    context: VerificationContext,
    attempt: number
  ): Promise<VerificationOutcome> {
    try {
      return await verifier.verify(context.target, context);
    } catch (error) {
      logger.warn(
        { scanId: context.scanId, targetId: context.target.targetId, attempt, error },
        'sniper.attempt: verifier threw'
      );
      return failedOutcome(`verifier threw: ${messageOf(error)}`, true);
    }
  }

  private async persistAttempt(
    parts: AttemptParts,
    outcome: VerificationOutcome,
    attempt: number,
    durationMs: number,
    startedAt: number
  ): Promise<void> {
    await this.repository.saveAttempt({
      exploitId: parts.exploitId,
      attemptNumber: attempt,
      verifier: outcome.verifier,
      tool: outcome.tool,
      status: outcome.status,
      stdout: outcome.toolSummary,
      stderr: outcome.toolStderr,
      errorMessage: outcome.status === 'FAILED' ? outcome.reason : null,
      exitCode: null,
      timedOut: outcome.status === 'FAILED' && /timeout/i.test(outcome.reason),
      retried: attempt > 1,
      startedAt: new Date(startedAt),
      completedAt: new Date(),
      durationMs,
    });
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// -- shared helpers (also used by the service / per-target runner) -----------

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function failedOutcome(reason: string, retryable = false): VerificationOutcome {
  return {
    status: 'FAILED',
    confidence: { score: 0, weighted: true, factors: [] },
    evidence: [],
    verifier: 'unknown',
    tool: '',
    toolSummary: '',
    toolStderr: '',
    reason,
    retryable,
  };
}