import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleEmbeddingClient } from './openai-compatible-embeddings';
import {
  EmbeddingAuthenticationError,
  EmbeddingDimensionError,
  EmbeddingResponseError,
  EmbeddingTimeoutError,
  EmbeddingUnavailableError,
} from '../../domain/errors/embedding.errors';

const DIMS = 2;

function makeClient(overrides: Partial<ConstructorParameters<typeof OpenAICompatibleEmbeddingClient>[0]> = {}) {
  return new OpenAICompatibleEmbeddingClient({
    baseUrl: 'https://embeddings.example/v1',
    apiKey: 'secret-key-123',
    model: 'model-x',
    dimensions: DIMS,
    timeoutMs: 5_000,
    maxRetries: 2,
    ...overrides,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAICompatibleEmbeddingClient', () => {
  it('embeds a single text and reports configured dimensions', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2] }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = makeClient();
    const vector = await client.embedText('hello');
    expect(vector).toEqual([0.1, 0.2]);
    expect(client.dimensions()).toBe(DIMS);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('model-x');
    expect(body.input).toEqual(['hello']);
  });

  it('embeds batches preserving order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { index: 0, embedding: [1, 2] },
            { index: 1, embedding: [3, 4] },
          ],
        }),
      ),
    );
    const vectors = await makeClient().embedBatch(['a', 'b']);
    expect(vectors).toEqual([[1, 2], [3, 4]]);
  });

  it('maps 401 to authentication error without leaking key material', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'invalid api key' }, 401)));
    await expect(makeClient().embedText('x')).rejects.toBeInstanceOf(EmbeddingAuthenticationError);
  });

  it('retries a 429 once then succeeds', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({ error: 'rate' }, 429)
          : jsonResponse({ data: [{ index: 0, embedding: [7, 8] }] });
      }),
    );
    const vector = await makeClient().embedText('x');
    expect(vector).toEqual([7, 8]);
    expect(calls).toBe(2);
  });

  it('gives up after bounded retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'busy' }, 503)));
    await expect(makeClient().embedText('x')).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });

  it('maps network failure to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    await expect(makeClient().embedText('x')).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });

  it('maps abort to timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      ),
    );
    await expect(makeClient().embedText('x')).rejects.toBeInstanceOf(EmbeddingTimeoutError);
  });

  it('rejects dimension mismatch with configured dims in the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] })),
    );
    await expect(makeClient().embedText('x')).rejects.toMatchObject({
      name: 'EmbeddingDimensionError',
      expected: DIMS,
      actual: 3,
    });
  });

  it('rejects malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(makeClient().embedText('x')).rejects.toBeInstanceOf(EmbeddingResponseError);
  });

  it('rejects empty data[]', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })));
    await expect(makeClient().embedText('x')).rejects.toBeInstanceOf(EmbeddingResponseError);
  });

  it('never leaks the api key in thrown errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'boom' }, 400)));
    try {
      await makeClient().embedText('x');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingResponseError);
      expect(String(error)).not.toContain('secret-key-123');
    }
  });
});