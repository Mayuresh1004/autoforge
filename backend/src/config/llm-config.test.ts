/**
 * Env-level defaults for the LLM block (MEDIUM-5, provider-aware):
 *   - the zod schema defaults to the free-first Gemini provider;
 *   - LLM_MODEL defaults to EMPTY — never the openrouter free alias — so a
 *     default install can never silently pair a wrong model with a
 *     non-openrouter provider;
 *   - only OpenRouter resolves the `openrouter/free` routing alias;
 *   - `LLM_PRIMARY_PROVIDER` still wins over `LLM_PROVIDER`.
 * Reads the live `llmConfig` export (env is empty in the vitest default
 * environment except DATABASE_URL/REDIS_URL/LOG_LEVEL).
 */

import { describe, expect, it } from 'vitest';
import { config, llmConfig, OPENROUTER_FREE_ALIAS, resolveDefaultLLMModel } from './index';

describe('llm config defaults', () => {
  it('defaults the provider to gemini and the model to empty (never the openrouter sentinel)', () => {
    expect(config.LLM_PROVIDER).toBe('gemini');
    expect(config.LLM_MODEL).toBe('');
    expect(llmConfig.provider).toBe('gemini');
    expect(llmConfig.model).toBe('');
  });

  it('keeps the free routing alias ONLY for the openrouter provider (provider-aware)', () => {
    expect(resolveDefaultLLMModel('openrouter', '')).toBe(OPENROUTER_FREE_ALIAS);
    expect(resolveDefaultLLMModel('gemini', '')).toBe('');
    expect(resolveDefaultLLMModel('groq', '')).toBe('');
    expect(resolveDefaultLLMModel('mistral', '')).toBe('');
  });

  it('preserves an explicit model over any default', () => {
    expect(resolveDefaultLLMModel('gemini', 'gemini-2.0-flash')).toBe('gemini-2.0-flash');
    expect(resolveDefaultLLMModel('groq', 'llama-3.3-70b-versatile')).toBe('llama-3.3-70b-versatile');
    expect(resolveDefaultLLMModel('openrouter', 'anthropic/claude-sonnet-4')).toBe('anthropic/claude-sonnet-4');
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