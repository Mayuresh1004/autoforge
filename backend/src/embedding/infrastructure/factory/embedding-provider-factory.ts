/**
 * EmbeddingProviderFactory — builds the single configured embedding provider.
 * Independent line of configuration from the LLM factory (EMBEDDING_* vs
 * LLM_*); unsupported provider or missing key → clear EmbeddingConfigError.
 */

import { EmbeddingConfigError } from '../../domain/errors/embedding.errors';
import type { EmbeddingConfig, EmbeddingProvider } from '../../domain/ports/embedding-provider';
import { GeminiEmbeddingProvider } from '../providers/gemini-embedding-provider';
import { NoopEmbeddingProvider } from '../providers/noop-embedding-provider';

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'noop':
      return new NoopEmbeddingProvider(config.dimensions);
    case 'gemini': {
      if (!config.apiKey) {
        throw new EmbeddingConfigError(
          'GEMINI_API_KEY is required when EMBEDDING_PROVIDER=gemini',
        );
      }
      return new GeminiEmbeddingProvider({
        apiKey: config.apiKey,
        model: config.model,
        dimensions: config.dimensions,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
      });
    }
  }
}