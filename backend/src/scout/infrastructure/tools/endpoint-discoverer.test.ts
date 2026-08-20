import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startScoutTestServer } from '../../../../test/helpers/scout-test-app';
import { DirectToolRuntime } from './direct-tool-runtime';
import { HttpCrawler } from './http-crawler';
import { RobotsTxtParser } from './robots-txt-parser';
import { ScoutEndpointDiscoverer } from './endpoint-discoverer';

describe('ScoutEndpointDiscoverer (live server)', () => {
  let origin: string;
  let close: () => Promise<void>;
  const runtime = new DirectToolRuntime();
  const crawler = new HttpCrawler(runtime);
  const discoverer = new ScoutEndpointDiscoverer(runtime);

  beforeAll(async () => {
    const server = await startScoutTestServer();
    origin = server.origin;
    close = server.close;
  });

  afterAll(async () => {
    await close();
  });

  it('discovers links, forms with parameters, GraphQL and WebSockets', async () => {
    const crawl = await crawler.crawl(origin + '/', { maxPages: 30, maxDepth: 2 });
    const robots = new RobotsTxtParser().parse(
      (await runtime.probe(origin + '/robots.txt')).body,
    );
    const result = await discoverer.discover({
      baseUrl: origin,
      pages: crawl.pages,
      robots,
      options: { timeoutMs: 3000, probeCommonPaths: true },
    });

    const urls = result.endpoints.map((e) => e.url);
    expect(urls.some((u) => u.includes('/about'))).toBe(true);
    expect(urls.some((u) => u.includes('/admin/users'))).toBe(true);

    // GraphQL detected from the probe response body.
    expect(result.graphql).toBe(true);

    // Form on the index page -> POST /api/search with parameters.
    const searchForm = result.forms.find((f) => f.action.includes('/api/search'));
    expect(searchForm?.method).toBe('POST');
    expect(searchForm?.inputs).toContain('query');

    // Form inputs surfaced as endpoint parameters.
    const searchEndpoint = result.endpoints.find((e) => e.url.includes('/api/search'));
    expect(searchEndpoint?.parameters).toContain('query');

    // WebSocket detected from page script hint.
    expect(result.websockets.length).toBeGreaterThan(0);
    expect(result.websockets.some((w) => w.url.includes('/ws'))).toBe(true);

    // robots disallow surfaced as probed endpoint.
    expect(urls.some((u) => u.includes('/admin'))).toBe(true);
  });

  it('skips common-path probing when disabled', async () => {
    const crawl = await crawler.crawl(origin + '/', { maxPages: 10, maxDepth: 1 });
    const result = await discoverer.discover({
      baseUrl: origin,
      pages: crawl.pages,
      robots: { userAgents: [], allowed: [], disallowed: [], sitemaps: [] },
      options: { timeoutMs: 3000, probeCommonPaths: false },
    });
    const urls = result.endpoints.map((e) => e.url);
    expect(urls.some((u) => u.endsWith('/health'))).toBe(false);
  });

  it('rejects external URLs (e.g. npm-audit references) and accepts same-origin endpoints', async () => {
    const pages = [
      {
        url: origin + '/sample',
        statusCode: 200,
        headers: {},
        html: `
          <a href="${origin}/internal-link">Internal</a>
          <a href="https://docs.npmjs.com/cli/v6/commands/npm-audit">External NPM Audit</a>
          <a href="https://www.owasp.org/index.php/Top_10">External OWASP</a>
        `,
      },
    ];
    const result = await discoverer.discover({
      baseUrl: origin,
      pages,
      robots: { userAgents: [], allowed: [], disallowed: [], sitemaps: [] },
      options: { timeoutMs: 1000, probeCommonPaths: false },
    });
    const urls = result.endpoints.map((e) => e.url);

    expect(urls).toContain(origin + '/sample');
    expect(urls).toContain(origin + '/internal-link');
    expect(urls.some((u) => u.includes('docs.npmjs.com'))).toBe(false);
    expect(urls.some((u) => u.includes('owasp.org'))).toBe(false);
  });

  it('never throws on unreachable targets', async () => {
    const result = await discoverer.discover({
      baseUrl: 'http://127.0.0.1:1',
      pages: [],
      robots: { userAgents: [], allowed: [], disallowed: [], sitemaps: [] },
      options: { timeoutMs: 500, probeCommonPaths: true },
    });
    expect(Array.isArray(result.endpoints)).toBe(true);
    expect(result.graphql).toBe(false);
  });
});