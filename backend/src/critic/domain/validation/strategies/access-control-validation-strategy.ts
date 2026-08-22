/**
 * AccessControlValidationStrategy — Vulnerability validation strategy for Broken Access Control & IDOR.
 *
 * Baseline: verifies that an unauthorized / cross-tenant request is allowed before patch.
 * Retest: verifies that after patch application, legitimate access is preserved while unauthorized
 * access is properly denied (HTTP 401/403/404) -> status NOT_CONFIRMED. Zero LLM involvement.
 */

import type { VulnerabilityType } from '../../../../sniper/domain/models/vulnerability-type';
import type {
  VulnerabilityValidationStrategy,
  ValidationStrategyContext,
  ValidationStrategyResult,
} from '../validation-strategy';

export class AccessControlValidationStrategy implements VulnerabilityValidationStrategy {
  readonly name = 'AccessControlValidationStrategy';

  supports(type: VulnerabilityType): boolean {
    return type === 'BROKEN_ACCESS_CONTROL' || type === 'IDOR' || type === 'AUTH_BYPASS';
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
        ? 'Broken Access Control / IDOR vulnerability confirmed in baseline sandbox'
        : 'Access control baseline invalid (unauthorized request was not allowed in baseline)',
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
