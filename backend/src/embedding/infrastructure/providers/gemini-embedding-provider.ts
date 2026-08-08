/**
 * Gemini embedding adapter — the single initial embedding provider.
 * Free/low-cost (Gemini free tier), no SDK, configurable model.
 */

import { OpenAICompatibleEmbeddingClient, type OpenAICompatibleEmbeddingOptions } from '../http/openai-compatible-embeddings';

export const GEMINI_EMBEDDING_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai';

export type GeminiEmbeddingOptions = Omit<OpenAICompatibleEmbeddingOptions, 'baseUrl'>;

export class GeminiEmbeddingProvider extends OpenAICompatibleEmbeddingClient {
  constructor(options: GeminiEmbeddingOptions) {
    super({ ...options, baseUrl: GEMINI_EMBEDDING_BASE_URL });
  }
}