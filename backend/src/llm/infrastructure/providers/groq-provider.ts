/**
 * Groq adapter (optional, free-tier capable).
 *
 * No model default is baked in: free-model availability changes over time, so
 * the exact model MUST come from configuration (LLM_MODEL or GROQ_MODEL).
 * Implementation is a thin, provider-specific shell over the shared
 * OpenAI-compatible substrate — zero LLM logic duplicated.
 */

import { OpenAICompatibleClient, type OpenAICompatibleClientOptions } from '../http/openai-compatible-client';

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export type GroqClientOptions = Omit<OpenAICompatibleClientOptions, 'provider' | 'baseUrl'>;

export class GroqLLMProvider extends OpenAICompatibleClient {
  constructor(options: GroqClientOptions) {
    super({
      ...options,
      provider: 'groq',
      baseUrl: GROQ_BASE_URL,
    });
  }
}
