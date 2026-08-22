/**
 * VulnerabilityValidationStrategy — Domain interface for vulnerability-specific
 * Critic validation algorithms.
 *
 * Critic owns orchestration (sandbox provisioning, patch applying, startup checks,
 * build/test checks, security gate, PR trigger). The strategy determines HOW a
 * specific vulnerability class is reproduced (baseline) and re-verified (retest)
 * deterministically. Zero LLM involvement.
 */

import type { VulnerabilityType } from '../../../sniper/domain/models/vulnerability-type';
import type { SniperService } from '../../../sniper/domain/ports/sniper-service';
import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';
import type { CriticPatchContext } from '../ports/critic-finding-resolver';
import type { CriticCheck, ExploitCriticOutcome } from '../models/critic-result';

export interface ValidationStrategyContext {
  readonly scanId: string;
  readonly context: CriticPatchContext;
  readonly sandbox: RuntimeSandboxContext;
  readonly checks: CriticCheck[];
  readonly runId: string;
  readonly sniper: SniperService;
  readonly retestTimeoutMs: number;
}

export interface ValidationStrategyResult {
  readonly status: 'CONFIRMED' | 'NOT_CONFIRMED' | 'BASELINE_INVALID' | 'INCONCLUSIVE' | 'FAILED';
  readonly detail?: string;
  readonly exploit?: ExploitCriticOutcome;
}

export interface VulnerabilityValidationStrategy {
  /** Unique strategy identifier for logs and observability events. */
  readonly name: string;

  /** True if this strategy handles the given canonical vulnerability type. */
  supports(vulnerabilityType: VulnerabilityType): boolean;

  /** Reproduce original vulnerability in fresh pre-patch sandbox. */
  validateBaseline(ctx: ValidationStrategyContext): Promise<ValidationStrategyResult>;

  /** Verify vulnerability status post-patch in updated sandbox. */
  validateRetest(
    ctx: ValidationStrategyContext,
    baselineResult: ValidationStrategyResult
  ): Promise<ValidationStrategyResult>;
}
