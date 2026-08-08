/**
 * NVD (NIST NVD v2.0) knowledge source — official machine-readable API only.
 * Bounded, incremental-capable paging (lastModStartDate style) and bounded
 * retries on transient failures (429/5xx) with a cap. Malformed records are
 * skipped and counted, never fatal. Returns normalized KnowledgeDocuments;
 * CVERecord persistence happens downstream in the ingestion service.
 */

import { KnowledgeSourceError } from '../../domain/errors/knowledge.errors';
import type {
  KnowledgeDocument,
  KnowledgeSourceType,
} from '../../domain/models/knowledge-document';
import type {
  KnowledgeFetchOptions,
  KnowledgeFetchResult,
  KnowledgeSource,
} from '../../domain/ports/knowledge-source';
import { normalizeNvdItem, type RawNvdVulnerability } from '../../application/services/cve-normalizer';

export interface NvdSourceOptions {
  readonly baseUrl: string;
  /** resultsPerPage per request (NVD supports up to 2000). */
  readonly pageSize: number;
  /** Hard cap on pages walked in one fetch() call. */
  readonly maxPages: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
}

const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

export class NvdKnowledgeSource implements KnowledgeSource {
  private readonly o: NvdSourceOptions;

  constructor(options: NvdSourceOptions) {
    this.o = options;
  }

  getName(): string {
    return 'nvd';
  }

  getType(): KnowledgeSourceType {
    return 'nvd';
  }

  async fetch(options: KnowledgeFetchOptions = {}): Promise<KnowledgeFetchResult> {
    const documents: KnowledgeDocument[] = [];
    let malformed = 0;
    let startIndex = 0;
    let fetched = 0;
    let hasMore = false;

    for (let page = 0; page < this.o.maxPages; page += 1) {
      const remaining = options.maxItems === undefined ? Infinity : options.maxItems - fetched;
      if (remaining <= 0) break;
      const pageSize = Math.min(this.o.pageSize, remaining);
      const params = new URLSearchParams({
        startIndex: String(startIndex),
        resultsPerPage: String(pageSize),
      });
      if (options.startTime !== undefined) {
        const from = toNvdDate(options.startTime);
        const until =
          options.endTime === undefined ? new Date().toISOString() : toNvdDate(options.endTime);
        params.set('lastModStartDate', from);
        params.set('lastModEndDate', until);
      }
      const url = `${this.o.baseUrl}?${params.toString()}`;
      const payload = await this.fetchWithRetry(url, 0);

      const items = payload.vulnerabilities;
      if (!Array.isArray(items)) {
        throw new KnowledgeSourceError(this.getName(), 'payload missing vulnerabilities[]');
      }
      for (const item of items) {
        try {
          const { document } = normalizeNvdItem(item as RawNvdVulnerability);
          documents.push(document);
          fetched += 1;
        } catch {
          malformed += 1;
        }
      }
      startIndex += items.length;
      if (items.length < pageSize) {
        hasMore = false;
        break;
      }
      if (fetched >= (options.maxItems ?? Infinity)) {
        // The caller's cap was consumed from a full page — more exist beyond it.
        hasMore = true;
        break;
      }
      if (page === this.o.maxPages - 1) {
        hasMore = true;
      }
    }

    return { documents, hasMore, malformed };
  }

  // --- internals ---------------------------------------------------------

  private async fetchWithRetry(
    url: string,
    attempt: number,
  ): Promise<{ vulnerabilities?: unknown; totalResults?: unknown }> {
    try {
      const response = await rawFetch(url, this.o.timeoutMs);
      if (response.ok) {
        return (await response.json()) as { vulnerabilities?: unknown; totalResults?: unknown };
      }
      if (!RETRYABLE_STATUSES.has(response.status)) {
        throw new KnowledgeSourceError(this.getName(), `http ${response.status}`);
      }
      if (attempt >= this.o.maxRetries) {
        throw new KnowledgeSourceError(
          this.getName(),
          `http ${response.status} after ${attempt} retries`,
        );
      }
      await sleep(this.o.retryDelayMs * (attempt + 1));
      return this.fetchWithRetry(url, attempt + 1);
    } catch (error) {
      if (error instanceof KnowledgeSourceError) throw error;
      if (attempt >= this.o.maxRetries) {
        throw new KnowledgeSourceError(this.getName(), 'network failure', error);
      }
      await sleep(this.o.retryDelayMs * (attempt + 1));
      return this.fetchWithRetry(url, attempt + 1);
    }
  }
}

async function rawFetch(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
  } finally {
    clearTimeout(timer);
  }
}

function toNvdDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}