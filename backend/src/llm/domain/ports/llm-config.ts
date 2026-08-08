/**
 * LLM provider configuration — the single shape consumed by the factory.
 * Populated from environment by `config/index.ts`; constructed directly in
 * tests. All values configurable; nothing hardcoded in application logic.
 */

import type { LLMProviderId } from './llm-provider';

export interface LLMProviderConfig {
  /** Primary provider (default: openrouter). */
  readonly provider: LLMProviderId;
  /** Default model (default: openrouter/free). */
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  /** Per-provider internal retries for transient failures (bounded, 0-5). */
  readonly maxRetries: number;
  /** Escalation order after the primary (bounded, no loops). */
  readonly fallbackProviders: readonly LLMProviderId[];
  readonly apiKeys: Readonly<Record<LLMProviderId, string | undefined>>;
  /** Per-provider model override (GROQ_MODEL / MISTRAL_MODEL / …). */
  readonly modelOverrides: Readonly<Record<LLMProviderId, string | undefined>>;
}