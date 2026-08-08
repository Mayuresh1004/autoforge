/**
 * Provider-agnostic LLM abstraction (free-first).
 *
 * The application depends ONLY on this interface. Provider-specific SDKs,
 * endpoint shapes and error codes never leak past each provider adapter;
 * no `any` types cross this boundary.
 *
 * Free-first policy: Gemini is the preferred default provider (model is
 * configuration-only — no concrete model is hardcoded). OpenRouter's
 * `openrouter/free` alias routes to whatever free model is currently
 * available — the app does NOT track which concrete model is served. Groq
 * and Mistral are optional alternates/fallbacks. At least one provider must
 * be configured; no single provider (and no paid provider at all) is a hard
 * dependency.
 */

/** Built-in provider ids. Extend here to add a provider — the factory must
 *  then be taught how to construct it.
 *
 *  Free-first preferred order (drives the DEFAULT provider and the suggested
 *  fallback order): Gemini → OpenRouter → Groq → Mistral. OpenAI/Anthropic
 *  are never required. */
export type LLMProviderId = 'gemini' | 'openrouter' | 'groq' | 'mistral';

export const LLM_PROVIDER_IDS: readonly LLMProviderId[] = [
  'gemini',
  'openrouter',
  'groq',
  'mistral',
] as const;

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  readonly role: LLMRole;
  readonly content: string;
}

/** Structured JSON output, where the provider exposes it (OpenAI-compatible
 *  `response_format`). Schema-constrained output is NOT enforced here. */
export type LLMResponseFormat = 'text' | 'json_object';

export interface LLMRequest {
  readonly messages: readonly LLMMessage[];
  /** Per-call model override; defaults to the configured model. */
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly responseFormat?: LLMResponseFormat;
}

export interface LLMUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** 0 when the provider reports no cost (free inference / no pricing data).
   *  AMASS never invents pricing. */
  readonly estimatedCost: number;
}

export interface LLMResponse {
  readonly text: string;
  readonly finishReason: string;
  readonly model: string;
  readonly usage: LLMUsage;
}

export interface ProviderHealth {
  readonly ok: boolean;
  readonly latencyMs: number;
  /** Human-readable, key-free explanation when unhealthy. */
  readonly detail?: string;
}

export interface ModelInfo {
  readonly provider: LLMProviderId;
  /** The concrete model id that will be used unless per-call overridden. */
  readonly model: string;
  /** True only when the model is OpenRouter's free alias. The app never
   *  assumes a specific free model remains available. */
  readonly freeAlias: boolean;
  readonly supportsStructuredJson: boolean;
}

export interface LLMProvider {
  generate(request: LLMRequest): Promise<LLMResponse>;
  healthCheck(): Promise<ProviderHealth>;
  getModelInfo(): ModelInfo;
}