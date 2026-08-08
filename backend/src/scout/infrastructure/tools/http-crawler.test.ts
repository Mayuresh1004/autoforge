import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startScoutTestServer } from '../../../../test/helpers/scout-test-app';
import { DirectToolRuntime } from './direct-tool-runtime';
import { HttpCrawler } from './http-crawler';

describe('HttpCrawler (live server)', () => {
  let origin: string;
  let close: () => Promise<void>;
  const runtime = new DirectToolRuntime();

  beforeAll(async () => {
    const server = await startScoutTestServer();
    origin = server.origin;
    close = server.close;
  });

  afterAll(async () => {
    await close();
  });

  it('crawls same-origin pages from the start page', async () => {
    const crawler = new HttpCrawler(runtime);
    const result = await crawler.crawl(origin + '/', {
      maxPages: 20,
      maxDepth: 2,
      probe: { timeoutMs: 3000 },
    });
    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain(origin + '/');
    expect(urls).toContain(origin + '/about');
    expect(urls).toContain(origin + '/login');
    expect(urls.some((u) => u.includes('/api/v1/items'))).toBe(true);
    // static assets are not crawled
    expect(urls.some((u) => u.includes('logo.png'))).toBe(false);
  });

  it('captures status codes', async () => {
    const crawler = new HttpCrawler(runtime);
    const result = await crawler.crawl(origin + '/', { maxPages: 20, maxDepth: 2 });
    const admin = result.pages.find((p) => p.url.includes('/admin/users'));
    expect(admin?.statusCode).toBe(401);
  });

  it('respects maxPages', async () => {
    const crawler = new HttpCrawler(runtime);
    const result = await crawler.crawl(origin + '/', { maxPages: 2, maxDepth: 1 });
    expect(result.pages.length).toBeLessThanOrEqual(2);
  });

  it('collects fetch errors instead of throwing (unreachable host)', async () => {
    const crawler = new HttpCrawler(runtime);
    const result = await crawler.crawl('http://127.0.0.1:1/', {
      maxPages: 5,
      maxDepth: 1,
      probe: { timeoutMs: 1000 },
    });
    expect(result.errors.length).toBeGreaterThan(0);
    // the failed probe is recorded as an unreachable page, never a throw
    expect(result.pages.every((p) => p.statusCode === null)).toBe(true);
  });
});