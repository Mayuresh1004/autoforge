/**
 * Fallback coordinator tests: escalation only on eligible failures, bounded
 * attempts, and hard rethrow for auth/policy/config/response failures.
 * Providers are stubs — zero HTTP.
 */

import { describe, expect, it, vi } from 'vitest';
import { FallbackLLMProvider } from './fallback-llm-provider';
import {
  LLMAuthenticationError,
  LLMRateLimitError,
  LLMUnavailableError,
  LLMModelUnavailableError,
  LLMPolicyError,
  LLMResponseError,
} from '../../domain/errors/llm.errors';
import type { LLMProvider, LLMRequest, LLMResponse } from '../ports/llm-provider';
import type { LLMProviderId } from '../ports/llm-provider';

const REQUEST: LLMRequest = { messages: [{ role: 'user', content: 'ping' }] };

function goodResponse(provider: string): LLMResponse {
  return {
    text: `ok from ${provider}`,
    finishReason: 'stop',
    model: provider,
    usage: { inputTokens: 1, outputTokens: 1, estimatedCost: 0 },
  };
}

type StubGenerate = ReturnType<typeof vi.fn<() => Promise<LLMResponse>>>;

function stubProvider(id: LLMProviderId, behavior: () => Promise<LLMResponse>): LLMProvider {
  return {
    generate: vi.fn<() => Promise<LLMResponse>>(behavior),
    healthCheck: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
    getModelInfo: () => ({
      provider: id,
      model: id === 'openrouter' ? 'openrouter/free' : `${id}-model`,
      freeAlias: false,
      supportsStructuredJson: true,
    }),
  };
}

function asGenerate(p: LLMProvider): StubGenerate {
  return (p as { generate: StubGenerate }).generate;
}

describe('FallbackLLMProvider', () => {
  it('returns the primary response when it succeeds', async () => {
    const primary = stubProvider('openrouter', async () => goodResponse('openrouter'));
    const fallback = stubProvider('groq', async () => goodResponse('groq'));
    const composite = new FallbackLLMProvider([primary, fallback]);

    const result = await composite.generate(REQUEST);
    expect(result.text).toBe('ok from openrouter');
    expect(asGenerate(primary)).toHaveBeenCalledTimes(1);
    expect(asGenerate(fallback)).not.toHaveBeenCalled();
  });

  it('escalates to the next provider on rate-limit (eligible)', async () => {
    const primary = stubProvider('openrouter', async () => {
      throw new LLMRateLimitError('openrouter', '429');
    });
    const fallback = stubProvider('groq', async () => goodResponse('groq'));
    const composite = new FallbackLLMProvider([primary, fallback]);

    const result = await composite.generate(REQUEST);
    expect(result.text).toBe('ok from groq');
    expect(asGenerate(primary)).toHaveBeenCalledTimes(1);
    expect(asGenerate(fallback)).toHaveBeenCalledTimes(1);
  });

  it('escalates on model-unavailable (free models rotate)', async () => {
    const primary = stubProvider('openrouter', async () => {
      throw new LLMModelUnavailableError('openrouter', 'openrouter/free', 'rotated');
    });
    const fallback = stubProvider('mistral', async () => goodResponse('mistral'));
    const composite = new FallbackLLMProvider([primary, fallback]);

    expect((await composite.generate(REQUEST)).text).toBe('ok from mistral');
  });

  it('rethrows authentication errors WITHOUT touching the fallback', async () => {
    const primary = stubProvider('openrouter', async () => {
      throw new LLMAuthenticationError('openrouter', 'invalid key');
    });
    const fallback = stubProvider('groq', async () => goodResponse('groq'));
    const composite = new FallbackLLMProvider([primary, fallback]);

    await expect(composite.generate(REQUEST)).rejects.toBeInstanceOf(LLMAuthenticationError);
    expect(asGenerate(fallback)).not.toHaveBeenCalled();
  });

  it('rethrows policy and response errors WITHOUT falling back (would repeat / masks bugs)', async () => {
    for (const error of [new LLMPolicyError('openrouter', 'policy'), new LLMResponseError('openrouter', 'garbled')]) {
      const primary = stubProvider('openrouter', async () => {
        throw error;
      });
      const fallback = stubProvider('groq', async () => goodResponse('groq'));
      const composite = new FallbackLLMProvider([primary, fallback]);
      await expect(composite.generate(REQUEST)).rejects.toBe(error);
      expect(asGenerate(fallback)).not.toHaveBeenCalled();
    }
  });

  it('throws the last error once every provider fails — bounded, no loops', async () => {
    const primary = stubProvider('openrouter', async () => {
      throw new LLMUnavailableError('openrouter', 'down');
    });
    const second = stubProvider('groq', async () => {
      throw new LLMRateLimitError('groq', '429');
    });
    const third = stubProvider('mistral', async () => {
      throw new LLMUnavailableError('mistral', 'down');
    });
    const composite = new FallbackLLMProvider([primary, second, third]);

    await expect(composite.generate(REQUEST)).rejects.toBeInstanceOf(LLMUnavailableError);
    expect(asGenerate(primary)).toHaveBeenCalledTimes(1);
    expect(asGenerate(second)).toHaveBeenCalledTimes(1);
    expect(asGenerate(third)).toHaveBeenCalledTimes(1);
  });

  it('rejects construction with an empty provider list', () => {
    expect(() => new FallbackLLMProvider([])).toThrowError(/at least one provider/);
  });

  it('healthCheck reflects the primary and surfaces the healthy-count detail', async () => {
    const primary = stubProvider('openrouter', async () => goodResponse('x'));
    const fallback = stubProvider('groq', async () => goodResponse('x'));
    const composite = new FallbackLLMProvider([primary, fallback]);

    const health = await composite.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.detail).toBe('2/2 providers healthy');
  });
});