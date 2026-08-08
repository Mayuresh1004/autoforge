/**
 * Message types for knowledge retrieval.
 */

import type { KnowledgeSeverity, KnowledgeSourceType } from '../models/knowledge-document';

export interface KnowledgeSearchFilters {
  readonly sourceType?: KnowledgeSourceType;
  readonly cveId?: string;
  readonly vulnerabilityType?: string;
  readonly severity?: KnowledgeSeverity;
  readonly language?: string;
  readonly framework?: string;
}

export interface KnowledgeSearchOptions {
  readonly topK: number;
  readonly filters?: KnowledgeSearchFilters;
}

export interface KnowledgeSearchResult {
  readonly id: string;
  /** Cosine similarity in [0,1]. Higher = more relevant. */
  readonly score: number;
  readonly payload: {
    readonly sourceType: KnowledgeSourceType;
    readonly cveId: string | null;
    readonly vulnerabilityType: string | null;
    readonly severity: KnowledgeSeverity | null;
    readonly language: string | null;
    readonly framework: string | null;
    readonly sourceUrl: string | null;
  } | null;
}

/** Application-level vector store — RAG depends on this, never on a vector
 *  DB SDK. */
export interface KnowledgeVectorStore {
  upsert(vectors: readonly VectorPoint[]): Promise<void>;
  search(
    queryVector: readonly number[],
    options: KnowledgeSearchOptions,
  ): Promise<KnowledgeSearchResult[]>;
  delete(ids: readonly string[]): Promise<void>;
}

/** A point ready for the vector store (id + embedding + small payload). */
export interface VectorPoint {
  readonly id: string;
  readonly embedding: readonly number[];
  readonly payload: KnowledgeVectorPayload;
}

export interface KnowledgeVectorPayload {
  readonly sourceType: KnowledgeSourceType;
  readonly cveId: string | null;
  readonly vulnerabilityType: string | null;
  readonly severity: KnowledgeSeverity | null;
  readonly language: string | null;
  readonly framework: string | null;
  readonly sourceUrl: string | null;
}