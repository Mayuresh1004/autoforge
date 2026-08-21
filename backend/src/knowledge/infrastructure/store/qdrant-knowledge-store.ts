/**
 * KnowledgeVectorStore backed by the Qdrant client. RAG depends on the port
 * (`KnowledgeVectorStore`), never on this or on Qdrant types.
 *
 * Payload discipline: only the small, useful metadata fields are stored
 * (sourceType / cveId / vulnerabilityType / severity / language / framework /
 * sourceUrl). No arbitrary JSON, no raw documents. Point ids are
 * deterministic (stable hash → UUID-format string) so re-ingestion is
 * idempotent.
 */

import { createHash } from 'node:crypto';
import type { KnowledgeSeverity } from '../../domain/models/knowledge-document';
import type { KnowledgeVectorStore, KnowledgeSearchOptions, KnowledgeSearchResult } from '../../domain/ports/knowledge-vector-store';
import type { VectorPoint } from '../../domain/ports/knowledge-vector-store';
import type { QdrantClient } from '../qdrant/qdrant-client';

export interface QdrantKnowledgeStoreOptions {
  readonly client: QdrantClient;
  readonly dimensions: number;
}

/** Deterministic UUID-format point id derived from a document id — stable
 *  across restarts and idempotent upserts. */
export function pointIdFromDocumentId(documentId: string): string {
  const hex = createHash('sha256').update(documentId).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class QdrantKnowledgeStore implements KnowledgeVectorStore {
  private readonly o: QdrantKnowledgeStoreOptions;

  constructor(options: QdrantKnowledgeStoreOptions) {
    this.o = options;
  }

  async upsert(vectors: readonly VectorPoint[]): Promise<void> {
    if (vectors.length === 0) return;
    await this.o.client.upsert(
      vectors.map((vector) => ({
        id: pointIdFromDocumentId(vector.id),
        vector: [...vector.embedding],
        payload: { ...vector.payload },
      })),
    );
  }

  async search(
    queryVector: readonly number[],
    options: KnowledgeSearchOptions,
  ): Promise<KnowledgeSearchResult[]> {
    const filters = toQdrantFilters(options.filters);
    const hits = await this.o.client.search(queryVector, options.topK, filters);
    return hits.map((hit) => ({
      id: hit.id,
      score: hit.score,
      payload: toPayload(hit.payload ?? null),
    }));
  }

  async delete(ids: readonly string[]): Promise<void> {
    await this.o.client.deleteByIds(ids.map(pointIdFromDocumentId));
  }

  /** Ensure the collection exists with the expected vector size. */
  async ensureCollection(): Promise<void> {
    await this.o.client.ensureCollection(this.o.dimensions);
  }
}

function toQdrantFilters(filters: KnowledgeSearchOptions['filters']): Readonly<{ key: string; value: unknown }[]> | undefined {
  if (!filters) return undefined;
  const out: { key: string; value: unknown }[] = [];
  const entries: Readonly<[string, unknown]>[] = [
    ['sourceType', filters.sourceType],
    ['cveId', filters.cveId],
    ['vulnerabilityType', filters.vulnerabilityType],
    ['severity', filters.severity],
    ['language', filters.language],
    ['framework', filters.framework],
  ];
  for (const [key, value] of entries) {
    if (value !== undefined && value !== null && value !== '') {
      out.push({ key, value });
    }
  }
  return out.length > 0 ? out : undefined;
}

function toPayload(raw: Readonly<Record<string, unknown>> | null): KnowledgeSearchResult['payload'] {
  if (!raw) return null;
  return {
    sourceType: asEnum(raw.sourceType),
    cveId: asNullableString(raw.cveId),
    vulnerabilityType: asNullableString(raw.vulnerabilityType),
    severity: asSeverity(raw.severity),
    language: asNullableString(raw.language),
    framework: asNullableString(raw.framework),
    sourceUrl: asNullableString(raw.sourceUrl),
  };
}

function asSeverity(value: unknown): KnowledgeSeverity | null {
  const choices: Readonly<Record<string, KnowledgeSeverity>> = {
    INFO: 'INFO',
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
  };
  return typeof value === 'string' ? (choices[value] ?? null) : null;
}

function asEnum(value: unknown): import('../../domain/models/knowledge-document').KnowledgeSourceType {
  return value === 'amass-kb' ? 'amass-kb' : 'nvd';
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}