/**
 * Fallback coordinator.
 *
 * Tries providers in configuration order. Escalation to the next provider
 * happens ONLY for fallback-eligible failures: RATE_LIMIT, UNAVAILABLE,
 * MODEL_UNAVAILABLE, TIMEOUT. Authentication errors, configuration errors,
 * malformed requests, policy rejections and unparseable responses are
 * rethrown immediately — none of them would succeed (or SHOULD be retried)
 * elsewhere, and silently masking an application bug is worse than failing.
 *
 * Bounded, never infinite: at most one pass over the provider list, each
 * provider's own bounded retries apply INSIDE its adapter. No call is looped
 * back to an already-failed provider.
 */

import { LLMError, isFallbackEligible } from '../../domain/errors/llm.errors';
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ModelInfo,
  ProviderHealth,
} from '../../domain/ports/llm-provider';
import { logger } from '../../../config/logger';

export class FallbackLLMProvider implements LLMProvider {
  /** Providers in attempt order (primary first). */
  private readonly providers: readonly LLMProvider[];

  constructor(providers: readonly LLMProvider[]) {
    if (providers.length === 0) {
      throw new Error('fallback provider requires at least one provider');
    }
    this.providers = providers;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    let lastError: unknown = null;
    for (let index = 0; index < this.providers.length; index += 1) {
      const provider = this.providers[index];
      try {
        const response = await provider.generate(request);
        if (index > 0) {
          logger.info(
            { llm: { hop: index + 1, provider: provider.getModelInfo().provider } },
            'llm_fallback_success',
          );
        }
        return response;
      } catch (error) {
        lastError = error;
        const eligible = isFallbackEligible(error);
        if (!eligible) {
          // Key/policy/config/response problems: rethrow immediately, never
          // attempt further providers.
          throw error;
        }
        if (index === this.providers.length - 1) {
          break;
        }
        logger.warn(
          {
            llm: {
              from: provider.getModelInfo().provider,
              code: error instanceof LLMError ? error.code : 'UNKNOWN',
              to: this.providers[index + 1].getModelInfo().provider,
            },
          },
          'llm_fallback_escalate',
        );
      }
    }
    throw lastError;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const results = await Promise.all(this.providers.map((p) => p.healthCheck()));
    const first = results[0];
    const up = results.filter((r) => r.ok).length;
    return {
      ok: first.ok,
      latencyMs: first.latencyMs,
      detail:
        results.length > 1
          ? `${up}/${results.length} providers healthy`
          : first.detail,
    };
  }

  getModelInfo(): ModelInfo {
    return this.providers[0].getModelInfo();
  }
}