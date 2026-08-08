/**
 * Knowledge source abstraction — ingestion feeds off this, never off a
 * concrete vendor API. NVD is the only implementation in this phase; future
 * sources (GHSA, OWASP, framework docs, verified fix commits) plug in here.
 */

import type { KnowledgeDocument, KnowledgeSourceType } from '../models/knowledge-document';

export interface KnowledgeFetchOptions {
  /** Optional ISO timestamp — incremental ingestion
   *  (NVD lastModStartDate/lastModEndDate style). */
  readonly startTime?: string;
  readonly endTime?: string;
  /** Bounded page window (defaults to source limits). */
  readonly maxItems?: number;
}

export interface KnowledgeFetchResult {
  readonly documents: KnowledgeDocument[];
  /** True when more items exist beyond the fetched window. */
  readonly hasMore: boolean;
  readonly cursor?: string;
  /** Records skipped because they failed validation (never fatal). */
  readonly malformed?: number;
}

export interface KnowledgeSource {
  getName(): string;
  getType(): KnowledgeSourceType;
  fetch(options: KnowledgeFetchOptions): Promise<KnowledgeFetchResult>;
}