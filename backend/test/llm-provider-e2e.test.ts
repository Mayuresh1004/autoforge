/**
 * OPT-IN live provider smoke tests.
 *
 * Never run in the default suite. Enable per provider:
 *   LLM_GEMINI_E2E=1      + GEMINI_API_KEY + GEMINI_MODEL
 *   LLM_OPENROUTER_E2E=1  + OPENROUTER_API_KEY
 *   LLM_GROQ_E2E=1        + GROQ_API_KEY + GROQ_MODEL
 *   LLM_MISTRAL_E2E=1     + MISTRAL_API_KEY + MISTRAL_MODEL
 * Each enabled provider gets exactly one minimal generation, a usage-record
 * check and a health check against the real API. Unconfigured providers are
 * reported as skipped.
 */
import { describe, expect, it } from 'vitest';
import { createLLMProvider } from '../src/llm/infrastructure/factory/llm-provider-factory';
import { InMemoryLLMUsageRecorder } from '../src/llm/application/services/llm-usage-recorder';
import type { LLMProviderConfig, LLMProviderId } from '../src/llm/domain/ports/llm-config';

interface ProviderGate {
  readonly ready: boolean;
  readonly config: LLMProviderConfig;
}

function gate(id: LLMProviderId, flagEnv: string, keyEnv: string, modelEnv: string): ProviderGate {
  const ready = process.env[flagEnv] === '1' && (process.env[keyEnv] ?? '').length > 0;
  const modelOverride = process.env[modelEnv] ?? '';
  // Only OpenRouter may use the free routing alias automatically; all other
  // providers need an explicit model (free models must not be assumed).
  const model = id === 'openrouter' ? 'openrouter/free' : modelOverride;
  const configured = ready && (id === 'openrouter' || model.length > 0);
  return {
    ready: configured,
    config: {
      provider: id,
      model,
      temperature: 0,
      maxTokens: 64,
      timeoutMs: 60_000,
      maxRetries: 0,
      fallbackProviders: [] as LLMProviderId[],
      apiKeys: {
        gemini: process.env.GEMINI_API_KEY ?? '',
        openrouter: process.env.OPENROUTER_API_KEY ?? '',
        groq: process.env.GROQ_API_KEY ?? '',
        mistral: process.env.MISTRAL_API_KEY ?? '',
      },
      modelOverrides: {
        gemini: process.env.GEMINI_MODEL,
        openrouter: process.env.OPENROUTER_MODEL,
        groq: process.env.GROQ_MODEL,
        mistral: process.env.MISTRAL_MODEL,
      },
    },
  };
}

const GEMINI = gate('gemini', 'LLM_GEMINI_E2E', 'GEMINI_API_KEY', 'GEMINI_MODEL');
const OPENROUTER = gate('openrouter', 'LLM_OPENROUTER_E2E', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL');
const GROQ = gate('groq', 'LLM_GROQ_E2E', 'GROQ_API_KEY', 'GROQ_MODEL');
const MISTRAL = gate('mistral', 'LLM_MISTRAL_E2E', 'MISTRAL_API_KEY', 'MISTRAL_MODEL');

async function smokeRun(gateCfg: ProviderGate): Promise<void> {
  const recorder = new InMemoryLLMUsageRecorder();
  const provider = createLLMProvider(gateCfg.config, { usageRecorder: recorder });
  const modelInfo = provider.getModelInfo();
  expect(modelInfo.provider).toBe(gateCfg.config.provider);

  const response = await provider.generate({
    messages: [{ role: 'user', content: 'Reply with exactly: AMASS_OK' }],
  });
  expect(response.text.length).toBeGreaterThan(0);
  expect(response.usage.outputTokens).toBeGreaterThan(0);

  const records = recorder.snapshot();
  expect(records).toHaveLength(1);
  expect(records[0].status).toBe('ok');
  expect(records[0].model).toBe(modelInfo.model);

  const health = await provider.healthCheck();
  expect(health.ok).toBe(true);
}

describe('live LLM provider smoke tests (opt-in LLM_*_E2E=1)', () => {
  it.skipIf(!GEMINI.ready)('gemini against the real API', async () => {
    await smokeRun(GEMINI);
  });

  it.skipIf(!OPENROUTER.ready)('openrouter against the real API', async () => {
    await smokeRun(OPENROUTER);
  });

  it.skipIf(!GROQ.ready)('groq against the real API', async () => {
    await smokeRun(GROQ);
  });

  it.skipIf(!MISTRAL.ready)('mistral against the real API', async () => {
    await smokeRun(MISTRAL);
  });
});