/**
 * LLMProviderFactory — builds the configured provider from configuration.
 *
 * - Provider selected via `LLM_PROVIDER` (default openrouter).
 * - Unsupported configured provider → clear LLMConfigError.
 * - Missing API key for ANY configured (primary or fallback) provider →
 *   clear LLMConfigError at construction time: misconfiguration surfaces
 *   before the first request, and no provider is silently skipped.
 * - `LLM_FALLBACK_PROVIDERS` (comma separated) builds a bounded
 *   FallbackLLMProvider; the chain never contains the primary twice.
 */

import { FallbackLLMProvider } from '../../application/services/fallback-llm-provider';
import type { LLMUsageRecorder } from '../../application/services/llm-usage-recorder';
import { LLMConfigError } from '../../domain/errors/llm.errors';
import type { LLMProviderConfig } from '../../domain/ports/llm-config';
import type { LLMProvider, LLMProviderId } from '../../domain/ports/llm-provider';
import { LLM_PROVIDER_IDS } from '../../domain/ports/llm-provider';
import { GeminiLLMProvider } from '../../infrastructure/providers/gemini-provider';
import { GroqLLMProvider } from '../../infrastructure/providers/groq-provider';
import { MistralLLMProvider } from '../../infrastructure/providers/mistral-provider';
import { OpenRouterLLMProvider, OPENROUTER_FREE_ALIAS } from '../../infrastructure/providers/openrouter-provider';

export type { LLMProviderConfig };

export interface LLMProviderFactoryOptions {
  readonly usageRecorder?: LLMUsageRecorder;
}

const ENV_KEY_BY_PROVIDER: Readonly<Record<LLMProviderId, string>> = {
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
};

export function createLLMProvider(
  config: LLMProviderConfig,
  options: LLMProviderFactoryOptions = {},
): LLMProvider {
  const recorder = options.usageRecorder;
  const chain: LLMProvider[] = [buildProvider(config.provider, config, recorder)];
  const seen = new Set<LLMProviderId>([config.provider]);

  for (const fallbackId of config.fallbackProviders) {
    assertSupported(fallbackId);
    if (seen.has(fallbackId)) continue;
    seen.add(fallbackId);
    chain.push(buildProvider(fallbackId, config, recorder));
  }

  return chain.length === 1 ? chain[0] : new FallbackLLMProvider(chain);
}

function assertSupported(id: LLMProviderId): void {
  if (!LLM_PROVIDER_IDS.includes(id)) {
    throw new LLMConfigError(`unsupported LLM provider: ${String(id)}`);
  }
}

function buildProvider(
  id: LLMProviderId,
  config: LLMProviderConfig,
  recorder: LLMUsageRecorder | undefined,
): LLMProvider {
  assertSupported(id);

  const apiKey = config.apiKeys[id];
  if (!apiKey) {
    throw new LLMConfigError(
      `${ENV_KEY_BY_PROVIDER[id]} is required when ${id} is configured as a provider`,
    );
  }

  const model = config.modelOverrides[id] ?? config.model;
  if (id !== 'openrouter' && model === OPENROUTER_FREE_ALIAS) {
    // `openrouter/free` is a routing alias — meaningless on other providers.
    // A model must come from LLM_MODEL or the per-provider override.
    throw new LLMConfigError(
      `${ENV_KEY_BY_PROVIDER[id]} (or LLM_MODEL) must name a model: 'openrouter/free' is invalid for ${id}`,
    );
  }
  const common = {
    apiKey,
    model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    usageRecorder: recorder,
  };

  switch (id) {
    case 'gemini':
      return new GeminiLLMProvider(common);
    case 'openrouter':
      return new OpenRouterLLMProvider(common);
    case 'groq':
      return new GroqLLMProvider(common);
    case 'mistral':
      return new MistralLLMProvider(common);
  }
}

function ENV_KEY_BY_PROVIDER_FOR(id: LLMProviderId): string {
  return ENV_KEY_BY_PROVIDER[id];
}