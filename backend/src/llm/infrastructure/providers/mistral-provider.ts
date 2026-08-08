/**
 * Mistral adapter (optional, free API mode).
 *
 * No model default is baked in: the exact model MUST come from configuration
 * (LLM_MODEL or MISTRAL_MODEL). Thin provider-specific shell over the shared
 * OpenAI-compatible substrate.
 */

import { OpenAICompatibleClient, type OpenAICompatibleClientOptions } from '../http/openai-compatible-client';

export const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';

export type MistralClientOptions = Omit<OpenAICompatibleClientOptions, 'provider' | 'baseUrl'>;

export class MistralLLMProvider extends OpenAICompatibleClient {
  constructor(options: MistralClientOptions) {
    super({
      ...options,
      provider: 'mistral',
      baseUrl: MISTRAL_BASE_URL,
    });
  }
}
