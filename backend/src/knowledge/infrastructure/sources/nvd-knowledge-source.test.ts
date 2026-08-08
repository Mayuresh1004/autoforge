import { afterEach, describe, expect, it, vi } from 'vitest';
import { NvdKnowledgeSource, type NvdSourceOptions } from './nvd-knowledge-source';
import { KnowledgeSourceError } from '../../domain/errors/knowledge.errors';

const opts: NvdSourceOptions = {
  baseUrl: 'https://nvd.example/rest/json/cves/2.0',
  pageSize: 2,
  maxPages: 3,
  timeoutMs: 5_000,
  maxRetries: 1,
  retryDelayMs: 1,
};

function nvdItem(id: string, description = `description for ${id}`) {
  return {
    id,
    descriptions: [{ lang: 'en', value: description }],
    published: '2024-01-01T00:00:00.000',
    lastModified: '2024-01-02T00:00:00.000',
  };
}

function pageResponse(items: unknown[]) {
  const payload = { totalResults: items.length, resultsPerPage: items.length, vulnerabilities: items };
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('NvdKnowledgeSource', () => {
  it('fetches documents and normalizes them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => pageResponse([nvdItem('CVE-2024-0001')])));
    const result = await new NvdKnowledgeSource(opts).fetch();
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].externalId).toBe('CVE-2024-0001');
    expect(result.documents[0].sourceType).toBe('nvd');
    expect(result.hasMore).toBe(false);
    expect(result.malformed).toBe(0);
  });

  it('walks multiple pages until an empty page', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        // Page 1 has one record; page 2 is empty → the walk stops there.
        return urls.length === 1
          ? pageResponse([nvdItem('CVE-2024-0001')])
          : pageResponse([]);
      }),
    );
    const result = await new NvdKnowledgeSource({ ...opts, pageSize: 1 }).fetch();
    expect(result.documents).toHaveLength(1);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('resultsPerPage=1');
    expect(urls[1]).toContain('startIndex=1');
  });

  it('caps at maxItems and reports hasMore when the page window is full', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return pageResponse([nvdItem(`CVE-2024-00${urls.length}`)]);
      }),
    );
    const result = await new NvdKnowledgeSource({ ...opts, pageSize: 1, maxPages: 3 }).fetch({
      maxItems: 3,
    });
    expect(result.documents).toHaveLength(3);
    expect(result.hasMore).toBe(true);
    expect(urls).toHaveLength(3);
  });

  it('skips malformed records and counts them, never failing the page', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        if (urls.length === 1) {
          return pageResponse([
            nvdItem('CVE-2024-0001'),
            { id: 'garbage' },
            { id: 'CVE-2024-9999', descriptions: [{ lang: 'de', value: 'no-english' }] },
          ]);
        }
        return pageResponse([]);
      }),
    );
    const result = await new NvdKnowledgeSource({ ...opts, pageSize: 2 }).fetch();
    expect(result.documents).toHaveLength(1);
    expect(result.malformed).toBe(2);
  });

  it('retries 429 then succeeds (transient)', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return calls === 1 ? new Response('rate limited', { status: 429 }) : pageResponse([nvdItem('CVE-2024-0001')]);
      }),
    );
    const result = await new NvdKnowledgeSource(opts).fetch();
    expect(calls).toBe(2);
    expect(result.documents).toHaveLength(1);
  });

  it('throws KnowledgeSourceError after exhausting retries on 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(new NvdKnowledgeSource(opts).fetch()).rejects.toBeInstanceOf(KnowledgeSourceError);
  });

  it('fails fast on non-retryable statuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })));
    await expect(new NvdKnowledgeSource(opts).fetch()).rejects.toMatchObject({ code: 'SOURCE_ERROR' });
  });

  it('passes lastModStartDate/EndDate window to the API', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return pageResponse([nvdItem('CVE-2024-0001')]);
      }),
    );
    await new NvdKnowledgeSource(opts).fetch({ startTime: '2024-06-01T00:00:00Z' });
    expect(urls[0]).toContain('lastModStartDate=');
    expect(urls[0]).toContain('lastModEndDate=');
  });
});