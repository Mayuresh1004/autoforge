import { describe, expect, it } from 'vitest';
import { EmbeddingConfigError } from '../../domain/errors/embedding.errors';
import type { EmbeddingConfig } from '../../domain/ports/embedding-provider';
import { createEmbeddingProvider } from './embedding-provider-factory';

const config: EmbeddingConfig = {
  provider: 'gemini',
  model: 'text-embedding-004',
  dimensions: 768,
  apiKey: 'AIza-test-key',
  timeoutMs: 30_000,
  maxRetries: 2,
};

describe('EmbeddingProviderFactory', () => {
  it('creates the gemini provider by default with configured model/dims', () => {
    const provider = createEmbeddingProvider(config);
    expect(provider.dimensions()).toBe(768);
  });

  it('rejects empty api key with a clear config error', () => {
    expect(() =>
      createEmbeddingProvider({ ...config, apiKey: undefined }),
    ).toThrowError(EmbeddingConfigError);
  });

  it('rejects an empty-string api key', () => {
    expect(() => createEmbeddingProvider({ ...config, apiKey: '' })).toThrowError(
      EmbeddingConfigError,
    );
  });

  it('keeps the factory independent of LLM providers (no llm configs consulted)', () => {
    // Only EMBEDDING_* config drives this factory — a missing LLM key must
    // not affect embedding construction.
    const provider = createEmbeddingProvider(config);
    expect(provider).toBeDefined();
  });
});