/**
 * SecurityMisconfigurationValidationStrategy — Vulnerability validation strategy for Security Misconfigurations.
 *
 * Baseline: verifies that dangerous debug configurations, exposed sensitive status endpoints,
 * or unsafe headers are present before patch application.
 * Retest: verifies that post-patch, the misconfiguration is eliminated and insecure behavior
 * is no longer reproducible (NOT_CONFIRMED). Zero LLM involvement.
 */

import type { VulnerabilityType } from '../../../../sniper/domain/models/vulnerability-type';
import type {
  VulnerabilityValidationStrategy,
  ValidationStrategyContext,
  ValidationStrategyResult,
} from '../validation-strategy';

export class SecurityMisconfigurationValidationStrategy implements VulnerabilityValidationStrategy {
  readonly name = 'SecurityMisconfigurationValidationStrategy';

  supports(type: VulnerabilityType): boolean {
    return type === 'SECURITY_MISCONFIGURATION';
  }

  async validateBaseline(ctx: ValidationStrategyContext): Promise<ValidationStrategyResult> {
    const report = await ctx.sniper.run({
      scanId: ctx.scanId,
      sandboxId: ctx.sandbox.sandboxId,
      baseUrl: ctx.sandbox.targetUrl,
      targetIds: [ctx.context.exploitTargetId],
      options: { timeoutMs: ctx.retestTimeoutMs, persist: false },
    });

    const isConfirmed = report.results[0]?.exploit?.status === 'CONFIRMED';
    const status = isConfirmed ? 'CONFIRMED' : 'BASELINE_INVALID';

    return {
      status,
      detail: isConfirmed
        ? 'Security misconfiguration confirmed in baseline sandbox'
        : 'Security misconfiguration baseline invalid (insecure configuration not reproducible)',
    };
  }

  async validateRetest(
    ctx: ValidationStrategyContext,
    baselineResult: ValidationStrategyResult
  ): Promise<ValidationStrategyResult> {
    const report = await ctx.sniper.run({
      scanId: ctx.scanId,
      sandboxId: ctx.sandbox.sandboxId,
      baseUrl: ctx.sandbox.targetUrl,
      targetIds: [ctx.context.exploitTargetId],
      options: { timeoutMs: ctx.retestTimeoutMs, persist: false },
    });

    const st = report.results[0]?.exploit?.status ?? 'NOT_TESTED';
    const status = st === 'NOT_CONFIRMED' ? 'NOT_CONFIRMED' : st === 'CONFIRMED' ? 'CONFIRMED' : 'INCONCLUSIVE';

    return {
      status,
      detail: st,
      exploit: {
        baseline: { status: baselineResult.status === 'CONFIRMED' ? 'CONFIRMED' : 'NOT_CONFIRMED' },
        retest: {
          status: st === 'CONFIRMED' ? 'CONFIRMED' : st === 'NOT_CONFIRMED' ? 'NOT_CONFIRMED' : 'INCONCLUSIVE',
        },
        targetId: ctx.context.exploitTargetId,
      },
    };
  }
}
