import type { ScoutToolRuntime } from '../../domain/ports/scout-tool-runtime';
import type { CrawledPage, Crawler, CrawlOptions, CrawlResult } from '../../domain/ports/crawler';
import { extractHrefs, isStaticAssetUrl } from './html';

/**
 * Same-origin breadth-first crawler. Respects maxPages / maxDepth, stays on
 * the start origin, and collects individual fetch errors instead of failing.
 * Only idle GET probes — the target is never written to.
 */
export class HttpCrawler implements Crawler {
  constructor(private readonly runtime: ScoutToolRuntime) {}

  async crawl(startUrl: string, options: CrawlOptions): Promise<CrawlResult> {
    const errors: string[] = [];
    const fetched = new Set<string>();
    const queued = new Set<string>([startUrl]);
    const pages: CrawledPage[] = [];
    const origin = this.originOf(startUrl);

    const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];

    while (queue.length > 0) {
      if (pages.length >= options.maxPages) break;
      const next = queue.shift();
      if (!next) break;
      if (fetched.has(next.url)) continue;
      fetched.add(next.url);

      try {
        const probe = await this.runtime.probe(next.url, {
          method: 'GET',
          timeoutMs: options.probe?.timeoutMs,
          maxBodyBytes: options.probe?.maxBodyBytes,
        });
        if (!probe.ok) errors.push(`GET ${next.url}: ${probe.error ?? 'not ok'}`);
        pages.push({
          url: probe.finalUrl || next.url,
          statusCode: probe.statusCode,
          headers: probe.headers,
          html: probe.body,
        });
        if (next.depth >= options.maxDepth) continue;

        for (const href of extractHrefs(probe.body)) {
          let resolved: URL;
          try {
            resolved = new URL(href, next.url);
          } catch {
            continue;
          }
          if (resolved.origin !== origin) continue; // same-origin only
          if (resolved.hash) resolved.hash = '';
          if (isStaticAssetUrl(resolved.href)) continue;
          if (queued.has(resolved.href) || fetched.has(resolved.href)) continue;
          queued.add(resolved.href);
          queue.push({ url: resolved.href, depth: next.depth + 1 });
        }
      } catch (err) {
        errors.push(`crawl ${next.url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { pages, errors };
  }

  private originOf(url: string): string {
    return new URL(url, 'http://localhost').origin;
  }
}