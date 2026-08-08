/**
 * Factory tests: configuration-driven provider selection (Gemini preferred),
 * clear config errors (unsupported provider / missing key / openrouter-free
 * sentinel on a non-OpenRouter provider), and bounded fallback assembly.
 * No real HTTP anywhere — construction only.
 *
 * The zod ENV default (`LLM_PROVIDER=gemini`) is asserted separately in
 * `config` tests; here every case passes an explicit config.
 */

import { describe, expect, it } from 'vitest';
import { createLLMProvider } from './llm-provider-factory';
import { FallbackLLMProvider } from '../../application/services/fallback-llm-provider';
import { LLMConfigError } from '../../domain/errors/llm.errors';
import type { LLMProviderConfig, LLMProviderId } from '../domain/ports/llm-config';
import { GeminiLLMProvider } from '../providers/gemini-provider';
import { OpenRouterLLMProvider } from '../providers/openrouter-provider';
import { GroqLLMProvider } from '../providers/groq-provider';
import { MistralLLMProvider } from '../providers/mistral-provider';

const KEYS: Record<LLMProviderId, string | undefined> = {
  gemini: 'AIzaSy0123456789abcdefghijklmnopqrstuv',
  openrouter: 'sk-openrouter-123',
  groq: 'groq-key-123',
  mistral: 'mistral-key-123',
};

const MODELS: Record<LLMProviderId, string | undefined> = {
  gemini: 'gemini-2.0-flash',
  openrouter: 'openrouter/free',
  groq: 'llama-3.1-8b-instant',
  mistral: 'mistral-small-latest',
};

function cfg(overrides: Partial<LLMProviderConfig> = {}): LLMProviderConfig {
  return {
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    temperature: 0.1,
    maxTokens: 1024,
    timeoutMs: 30_000,
    maxRetries: 1,
    fallbackProviders: [],
    apiKeys: { ...KEYS },
    modelOverrides: { ...MODELS },
    ...overrides,
  };
}

describe('createLLMProvider factory', () => {
  it('selects the preferred Gemini provider with its configured model (nothing baked in)', () => {
    const provider = createLLMProvider(cfg());
    expect(provider).toBeInstanceOf(GeminiLLMProvider);
    expect(provider.getModelInfo()).toEqual({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      freeAlias: false,
      supportsStructuredJson: true,
    });
  });

  it('honors the GEMINI_MODEL-style override over the global model', () => {
    const provider = createLLMProvider(
      cfg({ modelOverrides: { ...MODELS, gemini: 'gemini-2.5-flash' } }),
    );
    expect(provider.getModelInfo().model).toBe('gemini-2.5-flash');
  });

  it('builds OpenRouter when selected, preserving the free routing alias', () => {
    const provider = createLLMProvider(cfg({ provider: 'openrouter' }));
    expect(provider).toBeInstanceOf(OpenRouterLLMProvider);
    expect(provider.getModelInfo()).toEqual({
      provider: 'openrouter',
      model: 'openrouter/free',
      freeAlias: true,
      supportsStructuredJson: true,
    });
  });

  it('builds Groq with its own model (never the openrouter-free sentinel)', () => {
    const provider = createLLMProvider(cfg({ provider: 'groq' }));
    expect(provider).toBeInstanceOf(GroqLLMProvider);
    expect(provider.getModelInfo().model).toBe('llama-3.1-8b-instant');
  });

  it('builds Mistral from configuration', () => {
    const provider = createLLMProvider(cfg({ provider: 'mistral' }));
    expect(provider).toBeInstanceOf(MistralLLMProvider);
    expect(provider.getModelInfo().model).toBe('mistral-small-latest');
  });

  it('rejects the openrouter/free alias as a model on non-openrouter providers (clear config error)', () => {
    const sentinelCfg = { ...cfg(), model: 'openrouter/free', modelOverrides: { ...MODELS, gemini: undefined } };
    expect(() => createLLMProvider(sentinelCfg)).toThrowError(/GEMINI_API_KEY.*must name a model/);
    expect(() => createLLMProvider({ ...sentinelCfg, provider: 'groq', modelOverrides: { ...MODELS, gemini: undefined, groq: undefined } })).toThrowError(
      /GROQ_API_KEY.*must name a model/,
    );
  });

  it('fails with a clear config error when the primary provider has no API key', () => {
    expect(() =>
      createLLMProvider(cfg({ apiKeys: { ...KEYS, gemini: undefined } })),
    ).toThrowError(/GEMINI_API_KEY/);
  });

  it('fails with a clear config error for an unsupported provider id', () => {
    const bad = { ...cfg(), provider: 'bedrock' } as unknown as LLMProviderConfig;
    expect(() => createLLMProvider(bad)).toThrowError(/unsupported LLM provider: bedrock/);
  });

  it('assembles a bounded fallback chain (gemini primary → openrouter → mistral), deduplicated', () => {
    const provider = createLLMProvider(
      cfg({ provider: 'gemini', fallbackProviders: ['openrouter', 'openrouter', 'mistral'] }),
    );
    expect(provider).toBeInstanceOf(FallbackLLMProvider);
  });

  it('fails with a clear config error when a listed fallback provider lacks a key', () => {
    expect(() =>
      createLLMProvider(
        cfg({ provider: 'gemini', fallbackProviders: ['groq'], apiKeys: { ...KEYS, groq: undefined } }),
      ),
    ).toThrowError(/GROQ_API_KEY is required when groq is configured/);
  });

  it('returns the single provider unchanged when no fallbacks are configured', () => {
    expect(createLLMProvider(cfg())).toBeInstanceOf(GeminiLLMProvider);
  });
});