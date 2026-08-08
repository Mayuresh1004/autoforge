/**
 * OpenRouter adapter — the DEFAULT provider.
 *
 * OpenRouter exposes an OpenAI-compatible API and routes the special
 * `openrouter/free` model alias to whatever free model is currently served.
 * The application never tracks which concrete model the alias resolves to —
 * it only knows the alias, and OpenRouter handles the routing.
 *
 * Free-first: this is the only provider with a built-in model default
 * (`openrouter/free`); every other provider requires an explicit model.
 */

import { OpenAICompatibleClient, type OpenAICompatibleClientOptions } from '../http/openai-compatible-client';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_FREE_ALIAS = 'openrouter/free';

export type OpenRouterClientOptions = Omit<OpenAICompatibleClientOptions, 'provider' | 'baseUrl'>;

export class OpenRouterLLMProvider extends OpenAICompatibleClient {
  constructor(options: OpenRouterClientOptions) {
    super({
      ...options,
      provider: 'openrouter',
      baseUrl: OPENROUTER_BASE_URL,
    });
  }
}
