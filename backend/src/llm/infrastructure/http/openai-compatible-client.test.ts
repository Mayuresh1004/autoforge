/**
 * Provider adapter tests — ALL HTTP is mocked. No real provider calls are
 * made in the default suite (opt-in E2E lives in test/llm-provider-e2e.test.ts).
 *
 * Cases cover the error taxonomy and its retry/fallback eligibility, JSON
 * mode, usage parsing, cost (0 unless the provider reports it), timeout and
 * network failures, and key hygiene (the API key must never surface in error
 * messages or logs).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiLLMProvider } from '../providers/gemini-provider';
import { OpenRouterLLMProvider } from '../providers/openrouter-provider';
import { GroqLLMProvider } from '../providers/groq-provider';
import { MistralLLMProvider } from '../providers/mistral-provider';
import {
  LLMAuthenticationError,
  LLMMalformedRequestError,
  LLMModelUnavailableError,
  LLMPolicyError,
  LLMRateLimitError,
  LLMResponseError,
  LLMTimeoutError,
  LLMUnavailableError,
  isFallbackEligible,
} from '../../domain/errors/llm.errors';
import type { LLMRequest } from '../../domain/ports/llm-provider';
import type { OpenAICompatibleClientOptions } from './openai-compatible-client';

const API_KEY = 'sk-test-do-not-leak-123456';

function options(overrides: Partial<OpenAICompatibleClientOptions> = {}): OpenAICompatibleClientOptions {
  return {
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: API_KEY,
    model: 'openrouter/free',
    temperature: 0.1,
    maxTokens: 512,
    timeoutMs: 10_000,
    maxRetries: 0,
    ...overrides,
  };
}

const REQUEST: LLMRequest = { messages: [{ role: 'user', content: 'hello' }] };

function okBody(content = 'hi there', usage: Record<string, unknown> = { prompt_tokens: 9, completion_tokens: 2 }): string {
  return JSON.stringify({
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { total_tokens: 11, ...usage },
  });
}

function errorBody(code: string, message = 'something went wrong'): string {
  return JSON.stringify({ error: { code, message } });
}

function httpResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: typeof fetch): ReturnType<typeof vi.fn<typeof fetch>> {
  const fn = vi.fn<typeof fetch>(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('OpenAI-compatible substrate (via OpenRouter adapter)', () => {
  it('returns text + usage on a successful call', async () => {
    stubFetch(async () => httpResponse(200, okBody('hello world', { prompt_tokens: 7, completion_tokens: 3 })));
    const provider = new OpenRouterLLMProvider(options());
    const response = await provider.generate(REQUEST);
    expect(response.text).toBe('hello world');
    expect(response.finishReason).toBe('stop');
    expect(response.model).toBe('openrouter/free');
    expect(response.usage).toEqual({ inputTokens: 7, outputTokens: 3, estimatedCost: 0 });
  });

  it('records cost only when the provider reports it (never invented)', async () => {
    stubFetch(async () =>
      httpResponse(200, okBody('paid', { prompt_tokens: 10, completion_tokens: 4, cost: 0.00021 })),
    );
    const provider = new OpenRouterLLMProvider(options());
    const response = await provider.generate(REQUEST);
    expect(response.usage.estimatedCost).toBe(0.00021);
  });

  it('sends OpenAI-compatible body incl. json_object response_format when requested', async () => {
    const fetchMock = stubFetch(async () => httpResponse(200, okBody('{"ok":true}')));
    const provider = new OpenRouterLLMProvider(options());
    await provider.generate({ ...REQUEST, responseFormat: 'json_object', model: 'some/model', temperature: 0.9, maxTokens: 100 });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('some/model');
    expect(body.temperature).toBe(0.9);
    expect(body.max_tokens).toBe(100);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
  });

  it('maps 401 to authentication error (never fallback-eligible)', async () => {
    stubFetch(async () => httpResponse(401, errorBody('invalid_api_key', 'invalid api key')));
    const provider = new OpenRouterLLMProvider(options());
    await expect(provider.generate(REQUEST)).rejects.toBeInstanceOf(LLMAuthenticationError);
    await provider.generate(REQUEST).catch((e: unknown) => {
      expect(isFallbackEligible(e)).toBe(false);
    });
  });

  it('maps 429 to rate-limit error (fallback-eligible) and parses retry_after', async () => {
    stubFetch(async () => httpResponse(429, JSON.stringify({ error: { message: 'rate limited' }, retry_after: 4.2 })));
    const provider = new OpenRouterLLMProvider(options());
    await expect(provider.generate(REQUEST)).rejects.toMatchObject({
      name: 'LLMRateLimitError',
      retryAfterSeconds: 4.2,
    });
    await provider.generate(REQUEST).catch((e: unknown) => expect(isFallbackEligible(e)).toBe(true));
  });

  it('maps 404 / model_not_found to model-unavailable (fallback-eligible)', async () => {
    stubFetch(async () => httpResponse(400, errorBody('model_not_found', 'the model is gone')));
    const provider = new OpenRouterLLMProvider(options());
    await expect(provider.generate(REQUEST)).rejects.toBeInstanceOf(LLMModelUnavailableError);
    await provider.generate(REQUEST).catch((e: unknown) => expect(isFallbackEligible(e)).toBe(true));
  });

  it('maps content-policy codes to policy error (never fallback-eligible)', async () => {
    stubFetch(async () => httpResponse(400, errorBody('content_filter', 'policy violation')));
    const provider = new OpenRouterLLMProvider(options());
    await expect(provider.generate(REQUEST)).rejects.toBeInstanceOf(LLMPolicyError);
    await provider.generate(REQUEST).catch((e: unknown) => expect(isFallbackEligible(e)).toBe(false));
  });

  it('maps generic 4xx to malformed-request (never fallback-eligible)', async () => {
    stubFetch(async () => httpResponse(400, errorBody('bad_request', 'context too long')));
    const provider = new OpenRouterLLMProvider(options());
    await expect(provider.generate(REQUEST)).rejects.toBeInstanceOf(LLMMalformedRequestError);
    await provider.generate(REQUEST).catch((e: unknown) => expect(isFallbackEligible(e)).toBe(false));
  });

  it('retries transient 5xx up to maxRetries, then succeeds', async () => {
    const fetchMock = stubFetch(async () => httpResponse(503, 'server overloaded'));
    fetchMock
      .mockResolvedValueOnce(httpResponse(503, 'server overloaded'))
      .mockResolvedValueOnce(httpResponse(200, okBody('recovered')));
    const provider = new OpenRouterLLMProvider(options({ maxRetries: 1 }));
    const response = await provider.generate(REQUEST);
    expect(response.text).toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws unavailable after retries are exhausted (never infinite)', async () => {
    const fetchMock = stubFetch(async () => httpResponse(500, 'boom'));
    const provider = new OpenRouterLLMProvider(options({ maxRetries: 2 }));
    await expect(provider.generate(REQUEST)).rejects.toBeInstanceOf(LLMUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-transient errors', async () => {
    const fetchMock = stubFetch(async () => httpResponse(401, errorBody('invalid_api_key')));
    const provider = new OpenRouterLLMProvider(options({ maxRetries: 3 }));
    await expect(provider.generate(REQUEST)).rejects.toBeInstanceOf(LLMAuthenticationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps network failures to unavailable (fallback-eligible)', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const provider = new OpenRouterLLMProvider(options());
    await expect(provider.generate(REQUEST)).rejects.toBeInstanceOf(LLMUnavailableError);
  });

  it('maps timeout to LLMTimeoutError (fallback-eligible)', async () => {
    stubFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const provider = new OpenRouterLLMProvider(options({ timeoutMs: 50 }));
    await expect(provider.generate(REQUEST)).rejects.toBeInstanceOf(LLMTimeoutError);
    await provider.generate(REQUEST).catch((e: unknown) => expect(isFallbackEligible(e)).toBe(true));
  });

  it('maps unparseable / empty provider payloads to response error (never fallback-eligible)', async () => {
    stubFetch(async () => httpResponse(200, 'not json at all'));
    const provider = new OpenRouterLLMProvider(options());
    await expect(provider.generate(REQUEST)).rejects.toBeInstanceOf(LLMResponseError);

    stubFetch(async () => httpResponse(200, JSON.stringify({ choices: [] })));
    await expect(provider.generate(REQUEST)).rejects.toBeInstanceOf(LLMResponseError);
    await provider.generate(REQUEST).catch((e: unknown) => expect(isFallbackEligible(e)).toBe(false));
  });

  it('never leaks the API key into error messages', async () => {
    stubFetch(async () => httpResponse(401, errorBody('invalid_api_key', 'bad key sk-test-do-not-leak-123456')));
    const provider = new OpenRouterLLMProvider(options());
    await provider.generate(REQUEST).catch((e: unknown) => {
      expect(String((e as Error).message)).not.toContain(API_KEY);
    });
  });

  it('estimates tokens when the provider omits usage counts (cost still 0)', async () => {
    stubFetch(async () => httpResponse(200, JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'abcdefgh' }, finish_reason: 'stop' }] })));
    const provider = new OpenRouterLLMProvider(options());
    const response = await provider.generate(REQUEST);
    expect(response.usage.inputTokens).toBeGreaterThan(0);
    expect(response.usage.estimatedCost).toBe(0);
  });

  it('healthCheck reports ok with latency on 200', async () => {
    stubFetch(async () => httpResponse(200, JSON.stringify({ data: [] })));
    const provider = new OpenRouterLLMProvider(options());
    const health = await provider.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('healthCheck reports down on 401 without leaking the key', async () => {
    stubFetch(async () => httpResponse(401, errorBody('invalid_api_key')));
    const provider = new OpenRouterLLMProvider(options());
    const health = await provider.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.detail).not.toContain(API_KEY);
  });

  it('getModelInfo reflects provider + configured model; only openrouter/free is a free alias', () => {
    expect(new GeminiLLMProvider(options({ provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' })).getModelInfo()).toEqual({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      freeAlias: false,
      supportsStructuredJson: true,
    });
    expect(new OpenRouterLLMProvider(options()).getModelInfo()).toEqual({
      provider: 'openrouter',
      model: 'openrouter/free',
      freeAlias: true,
      supportsStructuredJson: true,
    });
    expect(new GroqLLMProvider(options({ provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant' })).getModelInfo().freeAlias).toBe(false);
    expect(new MistralLLMProvider(options({ provider: 'mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' })).getModelInfo().model).toBe('mistral-small-latest');
  });
});