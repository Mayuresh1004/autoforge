/**
 * Env-level defaults for the LLM block: the zod schema must default to the
 * preferred free-first Gemini provider, keep `openrouter/free` as the model
 * default, and honour `LLM_PRIMARY_PROVIDER` over `LLM_PROVIDER` when both
 * are set. Reads the live `llmConfig` export (env is empty in the vitest
 * default environment except DATABASE_URL/REDIS_URL/LOG_LEVEL).
 */

import { describe, expect, it } from 'vitest';
import { config, llmConfig } from './index';

describe('llm config defaults', () => {
  it('defaults the provider to gemini and the model to the openrouter free alias', () => {
    expect(config.LLM_PROVIDER).toBe('gemini');
    expect(config.LLM_MODEL).toBe('openrouter/free');
    expect(llmConfig.provider).toBe('gemini');
    expect(llmConfig.model).toBe('openrouter/free');
  });

  it('resolves LLM_PRIMARY_PROVIDER over LLM_PROVIDER when set', () => {
    const resolved = config.LLM_PRIMARY_PROVIDER ?? config.LLM_PROVIDER;
    expect(llmConfig.provider).toBe(resolved);
  });

  it('keeps explicit fallback configuration empty by default (no implicit chains)', () => {
    expect(llmConfig.fallbackProviders).toEqual([]);
  });

  it('bounds retries (never unlimited) and timeout', () => {
    expect(config.LLM_MAX_RETRIES).toBeGreaterThanOrEqual(0);
    expect(config.LLM_MAX_RETRIES).toBeLessThanOrEqual(5);
    expect(config.LLM_TIMEOUT_MS).toBeGreaterThanOrEqual(1_000);
  });
});