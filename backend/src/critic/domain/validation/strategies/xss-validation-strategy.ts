/**
 * XssValidationStrategy — Vulnerability validation strategy for Reflected XSS.
 *
 * Baseline: verifies that the XSS payload is reflected unescaped in the response
 * (as confirmed by Sniper verifier).
 * Retest: verifies that after patch application, the payload is properly encoded/sanitized
 * or no longer reflected in an executable context (NOT_CONFIRMED). Zero LLM involvement.
 */

import type { VulnerabilityType } from '../../../../sniper/domain/models/vulnerability-type';
import type {
  VulnerabilityValidationStrategy,
  ValidationStrategyContext,
  ValidationStrategyResult,
} from '../validation-strategy';

export class XssValidationStrategy implements VulnerabilityValidationStrategy {
  readonly name = 'XssValidationStrategy';

  supports(type: VulnerabilityType): boolean {
    return type === 'XSS';
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
        ? 'Reflected XSS exploit payload confirmed executable in baseline sandbox'
        : 'Reflected XSS baseline invalid (payload not reflected or not executable)',
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
