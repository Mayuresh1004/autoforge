/**
 * Provider-agnostic embedding abstraction.
 *
 * DELIBERATELY INDEPENDENT from the LLM provider: an LLM provider and an
 * embedding provider are different axes of configuration (EMBEDDING_PROVIDER
 * vs LLM_PROVIDER). The LLM adapters are never used for embeddings.
 *
 * Free-first: the single initial provider is Gemini via Google's official
 * OpenAI-compatible embeddings endpoint (no SDK, no local model infra).
 * Future providers slot behind the same interface.
 */

export interface EmbeddingProvider {
  /** Embed a single text. Rejects when the returned vector length does not
   *  match the configured dimensions. */
  embedText(text: string): Promise<number[]>;
  /** Embed many texts. Rejects on any item failure (no partial results). */
  embedBatch(texts: readonly string[]): Promise<number[][]>;
  /** Expected vector length for every embedding. */
  dimensions(): number;
}

/** Config consumed by the embedding factory. All values zod-bounded. */
export interface EmbeddingConfig {
  readonly provider: 'gemini' | 'noop';
  readonly model: string;
  readonly dimensions: number;
  readonly apiKey?: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}