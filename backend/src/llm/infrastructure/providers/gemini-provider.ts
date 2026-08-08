/**
 * Gemini adapter — preferred free/low-cost provider.
 *
 * Uses Gemini's official OpenAI-compatible endpoint
 * (`…/v1beta/openai`), so it rides the SAME shared substrate as the other
 * providers — no Gemini SDK anywhere, and provider-specific code stays in
 * this adapter.
 *
 * The exact model is configuration-only (GEMINI_MODEL / LLM_MODEL / per-call
 * `request.model`); NO concrete Google model is hardcoded here (free-tier
 * model availability changes over time).
 */

import { OpenAICompatibleClient, type OpenAICompatibleClientOptions } from '../http/openai-compatible-client';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

export type GeminiClientOptions = Omit<OpenAICompatibleClientOptions, 'provider' | 'baseUrl'>;

export class GeminiLLMProvider extends OpenAICompatibleClient {
  constructor(options: GeminiClientOptions) {
    super({
      ...options,
      provider: 'gemini',
      baseUrl: GEMINI_BASE_URL,
    });
  }
}