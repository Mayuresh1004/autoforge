/**
 * In-memory KnowledgeVectorStore for deterministic, offline tests/acceptance.
 * Cosine similarity over explicit vectors — no networking, no SDKs.
 * Mirrors the Qdrant store's payload shape so switches are behavioral.
 */

import { createHash } from 'node:crypto';
import type {
  KnowledgeSearchOptions,
  KnowledgeSearchResult,
  KnowledgeVectorPayload,
  VectorPoint,
  KnowledgeVectorStore,
} from '../../../src/knowledge/domain/ports/knowledge-vector-store';

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    na += a[index] * a[index];
    nb += b[index] * b[index];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Deterministic point id (mirrors the production store's id derivation). */
export function testPointId(documentId: string): string {
  const hex = createHash('sha256').update(documentId).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class MemoryKnowledgeVectorStore implements KnowledgeVectorStore {
  private readonly points = new Map<string, VectorPoint>();

  async upsert(vectors: readonly VectorPoint[]): Promise<void> {
    for (const vector of vectors) {
      this.points.set(vector.id, vector);
    }
  }

  async search(
    queryVector: readonly number[],
    options: KnowledgeSearchOptions,
  ): Promise<KnowledgeSearchResult[]> {
    const scored: { id: string; score: number; payload: VectorPoint['payload'] }[] = [];
    for (const point of this.points.values()) {
      const score = cosineSimilarity(queryVector, point.embedding);
      if (matches(point.payload, options.filters)) {
        scored.push({ id: point.id, score, payload: point.payload });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, options.topK);
    return top.map((hit) => ({
      id: hit.id,
      score: hit.score,
      payload: hit.payload,
    }));
  }

  async delete(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      this.points.delete(testPointId(id));
    }
  }

  count(): number {
    return this.points.size;
  }

  async clear(): Promise<void> {
    this.points.clear();
  }
}

function matches(
  payload: VectorPoint['payload'] | null,
  filters: KnowledgeSearchOptions['filters'],
): boolean {
  if (!filters || !payload) return true;
  if (filters.sourceType !== undefined && payload.sourceType !== filters.sourceType) return false;
  if (filters.cveId !== undefined && payload.cveId !== filters.cveId) return false;
  if (
    filters.vulnerabilityType !== undefined &&
    (payload.vulnerabilityType ?? null) !== filters.vulnerabilityType
  ) {
    return false;
  }
  if (filters.severity !== undefined && payload.severity !== filters.severity) return false;
  return true;
}