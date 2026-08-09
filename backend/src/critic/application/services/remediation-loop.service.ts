/**
 * RemediationLoopService — Phase 8 retry driver. Bounded Engineer→Critic
 * loop with deterministic feedback:
 *
 *   attempt 1: Engineer drafts patch → Critic validates
 *   on REJECTED: feedback is passed to the next Engineer attempt (prompt
 *                section), up to maxEngineerAttempts (configurable via
 *                CRITIC_MAX_ENGINEER_RETRIES).
 *   on APPROVED: loop ends (patch approved, app installed nowhere).
 *   on FAILED:   loop ends — infrastructure problems never retrigger
 *                Engineer work blindly.
 *
 * The loop NEVER applies a patch and never mutates the original repo.
 */

import type { EngineerService, EngineerRunResult } from '../../../engineer/application/services/engineer.service';
import type { EngineerFeedback } from '../../../engineer/domain/models/engineer-feedback';
import type { CriticService } from './critic.service';
import type { CriticRunResult } from '../../domain/models/critic-result';

export interface RemediationLoopInput {
  readonly scanId: string;
  /** Optional explicit target; omitted → deterministic Engineer pick. */
  readonly vulnerabilityId?: string;
}

export interface RemediationAttemptRecord {
  readonly attempt: number;
  readonly engineer: EngineerRunResult | null;
  readonly critic: CriticRunResult | null;
}

export interface RemediationLoopResult {
  readonly scanId: string;
  readonly vulnerabilityId: string;
  readonly attempts: readonly RemediationAttemptRecord[];
  readonly finalStatus: 'APPROVED' | 'REJECTED' | 'FAILED';
  readonly reason: string | null;
}

export interface RemediationLoopDependencies {
  readonly engineer: EngineerService;
  readonly critic: CriticService;
  /** Total engineering attempts allowed (1 initial + retries). */
  readonly maxEngineerAttempts: number;
}

export class RemediationLoopService {
  constructor(private readonly deps: RemediationLoopDependencies) {}

  async run(input: RemediationLoopInput): Promise<RemediationLoopResult> {
    const attempts: RemediationAttemptRecord[] = [];
    let vulnerabilityId = input.vulnerabilityId ?? '';
    let feedback: EngineerFeedback | null = null;

    for (let attempt = 1; attempt <= this.deps.maxEngineerAttempts; attempt++) {
      let engineer: EngineerRunResult;
      try {
        engineer = await this.deps.engineer.run({
          scanId: input.scanId,
          vulnerabilityId: vulnerabilityId.length > 0 ? vulnerabilityId : undefined,
          feedback,
        });
        vulnerabilityId = engineer.vulnerabilityId;
      } catch (error) {
        const msg = error instanceof Error ? error.message.slice(0, 300) : 'engineer failed';
        return this.done(input.scanId, vulnerabilityId, attempts, 'FAILED', msg);
      }

      if (engineer.status !== 'GENERATED' || !engineer.patchId) {
        attempts.push({ attempt, engineer, critic: null });
        return this.done(
          input.scanId,
          vulnerabilityId,
          attempts,
          'REJECTED',
          engineer.summary.reason ?? 'engineer did not produce a patch',
        );
      }

      let critic: CriticRunResult;
      try {
        critic = await this.deps.critic.run({ patchId: engineer.patchId, attempt });
      } catch (error) {
        attempts.push({ attempt, engineer, critic: null });
        const msg = error instanceof Error ? error.message.slice(0, 300) : 'critic failed';
        return this.done(input.scanId, vulnerabilityId, attempts, 'FAILED', msg);
      }
      attempts.push({ attempt, engineer, critic });

      if (critic.status === 'APPROVED') {
        return this.done(input.scanId, vulnerabilityId, attempts, 'APPROVED', null);
      }
      if (critic.status === 'FAILED') {
        return this.done(
          input.scanId,
          vulnerabilityId,
          attempts,
          'FAILED',
          `validation infrastructure: ${critic.failureKind ?? 'FAILED'}`,
        );
      }

      // REJECTED → carry feedback into the next attempt (bounded)
      feedback = critic.feedback
        ? {
            reason: critic.feedback.reason,
            failedChecks: critic.feedback.failedChecks.slice(0, 6),
            guidance: critic.feedback.guidance,
            attempt,
          }
        : null;
    }

    return this.done(input.scanId, vulnerabilityId, attempts, 'REJECTED', 'patch rejected after max attempts');
  }

  private done(
    scanId: string,
    vulnerabilityId: string,
    attempts: readonly RemediationAttemptRecord[],
    finalStatus: 'APPROVED' | 'REJECTED' | 'FAILED',
    reason: string | null,
  ): RemediationLoopResult {
    return { scanId, vulnerabilityId, attempts, finalStatus, reason };
  }
}