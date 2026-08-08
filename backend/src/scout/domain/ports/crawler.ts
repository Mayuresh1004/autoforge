import type { HttpProbeOptions } from './scout-tool-runtime';

export interface CrawledPage {
  readonly url: string;
  readonly statusCode: number | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly html: string;
}

export interface CrawlOptions {
  readonly maxPages: number;
  readonly maxDepth: number;
  readonly probe?: HttpProbeOptions;
}

export interface CrawlResult {
  readonly pages: readonly CrawledPage[];
  /** Non-fatal crawl errors (individual fetches), collected not thrown. */
  readonly errors: readonly string[];
}

/** Discovers pages of the target application by following same-origin links. */
export interface Crawler {
  crawl(startUrl: string, options: CrawlOptions): Promise<CrawlResult>;
}