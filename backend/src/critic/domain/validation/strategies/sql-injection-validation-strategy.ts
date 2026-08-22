/**
 * SqlInjectionValidationStrategy — Vulnerability validation strategy for SQL Injection.
 *
 * Uses Sniper's exploit infrastructure to confirm the baseline SQL injection exploit succeeds
 * before patch application, and verifies that the exact same exploit fails (NOT_CONFIRMED) post-patch.
 */

import type { VulnerabilityType } from '../../../../sniper/domain/models/vulnerability-type';
import type {
  VulnerabilityValidationStrategy,
  ValidationStrategyContext,
  ValidationStrategyResult,
} from '../validation-strategy';

export class SqlInjectionValidationStrategy implements VulnerabilityValidationStrategy {
  readonly name = 'SqlInjectionValidationStrategy';

  supports(type: VulnerabilityType): boolean {
    return type === 'SQL_INJECTION';
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
        ? 'SQL injection exploit confirmed in fresh sandbox'
        : 'SQL injection exploit baseline invalid (not reproducible)',
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
