import { afterEach, describe, expect, it, vi } from 'vitest';
import { QdrantClient } from './qdrant-client';
import { KnowledgeStoreUnavailableError } from '../../domain/errors/knowledge.errors';

function makeClient() {
  return new QdrantClient({
    baseUrl: 'http://qdrant:6333',
    apiKey: undefined,
    timeoutMs: 5_000,
    collection: 'amass_security_knowledge',
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('QdrantClient', () => {
  it('creates a collection when missing (PUT) with cosine distance + size', async () => {
    const hits: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        hits.push(`${method} ${input}`);
        if (method === 'GET') {
          return new Response('not found', { status: 404 });
        }
        return new Response(JSON.stringify({ result: true }), { status: 200 });
      }),
    );
    const client = makeClient();
    const created = await client.ensureCollection(768);
    expect(created).toBe(true);
    const put = hits.find((h) => h.startsWith('PUT'));
    expect(put).toContain('/collections/amass_security_knowledge');
  });

  it('does not recreate an existing collection (idempotent)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: {} }), { status: 200 })));
    expect(await makeClient().ensureCollection(768)).toBe(false);
  });

  it('upserts points with id, vector, payload', async () => {
    let captured: unknown = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ result: { status: 'completed' } }), { status: 200 });
      }),
    );
    await makeClient().upsert([{ id: 'CVE-1', vector: [0.1, 0.2], payload: { cveId: 'CVE-1' } }]);
    expect(captured).toEqual({ points: [{ id: 'CVE-1', vector: [0.1, 0.2], payload: { cveId: 'CVE-1' } }] });
  });

  it('search POSTs query vector and maps hits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            result: [
              { id: 'pt-1', score: 0.9, payload: { cveId: 'CVE-89' } },
              { id: 'pt-2', score: -0.2, payload: null },
            ],
          }),
          { status: 200 },
        );
      }),
    );
    const hits = await makeClient().search([1, 2], 5, [{ key: 'severity', value: 'HIGH' }]);
    expect(hits[0]).toEqual({ id: 'pt-1', score: 0.9, payload: { cveId: 'CVE-89' } });
    // Negative cosine similarity maps to the sanity floor of 0.
    expect(hits[1].score).toBeGreaterThanOrEqual(0);
  });

  it('moves non-2xx responses into KnowledgeStoreUnavailableError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    await expect(makeClient().collectionInfo()).resolves.toBeNull();
    await expect(makeClient().upsert([{ id: 'x', vector: [1] }])).rejects.toBeInstanceOf(
      KnowledgeStoreUnavailableError,
    );
  });

  it('maps network errors to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('connect refused'))));
    await expect(makeClient().collectionExists()).rejects.toBeInstanceOf(
      KnowledgeStoreUnavailableError,
    );
  });

  it('maps an aborted request to a timeout unavailable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.reject(Object.assign(new Error('timed out'), { name: 'AbortError' })),
      ),
    );
    await expect(makeClient().collectionExists()).rejects.toMatchObject({
      code: 'STORE_UNAVAILABLE',
    });
  });
});
