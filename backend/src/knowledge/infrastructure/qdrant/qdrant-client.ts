/**
 * Minimal Qdrant REST client (fetch-based — no SDK, matching the codebase's
 * no-SDK style). This is the ONE Qdrant client in the backend; the existing
 * Python `QdrantService` and backend health probes remain untouched. Only
 * collection CRUD + point add/search/delete are implemented — everything RAG
 * needs. All errors surface as KnowledgeStoreUnavailableError / UNAVAILABLE
 * timeouts so RAG can react without knowing Qdrant.
 */

import { KnowledgeStoreUnavailableError } from '../../domain/errors/knowledge.errors';

export interface QdrantClientOptions {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly timeoutMs: number;
  readonly collection: string;
}

export interface QdrantPoint {
  readonly id: string;
  readonly vector: readonly number[];
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface QdrantSearchHit {
  readonly id: string;
  /** Qdrant score (higher = closer for cosine distance). */
  readonly score: number;
  readonly payload?: Readonly<Record<string, unknown>> | null;
}

export interface QdrantCollectionInfo {
  readonly status: string;
  readonly pointsCount: number;
  readonly segmentsCount: number;
}

interface QdrantFilterClause {
  readonly key: string;
  readonly value: unknown;
}

export class QdrantClient {
  private readonly o: QdrantClientOptions;

  constructor(options: QdrantClientOptions) {
    this.o = options;
  }

  /** True when the collection was created by this call. */
  async ensureCollection(vectorSize: number): Promise<boolean> {
    if (await this.collectionExists()) {
      return false;
    }
    await this.expectOk(
      await this.request('PUT', `/collections/${this.o.collection}`, {
        vectors: { size: vectorSize, distance: 'Cosine' },
      }),
      'ensure collection',
    );
    return true;
  }

  async collectionExists(): Promise<boolean> {
    const response = await this.request('GET', `/collections/${this.o.collection}`);
    return response.ok;
  }

  async upsert(points: readonly QdrantPoint[]): Promise<void> {
    const response = await this.request(
      'PUT',
      `/collections/${this.o.collection}/points`,
      {
        points: points.map((point) => ({
          id: point.id,
          vector: [...point.vector],
          payload: point.payload ?? {},
        })),
      },
    );
    this.expectOk(response, 'upsert');
  }

  async search(
    queryVector: readonly number[],
    topK: number,
    filters?: readonly QdrantFilterClause[],
  ): Promise<QdrantSearchHit[]> {
    const body: Record<string, unknown> = {
      vector: [...queryVector],
      limit: topK,
      with_payload: true,
      with_vector: false,
    };
    if (filters !== undefined && filters.length > 0) {
      body.filter = { must: filters.map((f) => ({ key: f.key, match: { value: f.value } })) };
    }
    const response = await this.request(
      'POST',
      `/collections/${this.o.collection}/points/search`,
      body,
    );
    this.expectOk(response, 'search');
    const raw = (await response.json()) as { result?: unknown };
    const hits = raw.result;
    if (!Array.isArray(hits)) {
      throw new KnowledgeStoreUnavailableError('search returned no result[]');
    }
    return hits.map((hit) => {
      const record = hit as { id?: unknown; score?: unknown; payload?: unknown };
      const rawScore = typeof record.score === 'number' ? record.score : 0;
      const score = Number.isFinite(rawScore) ? Math.max(0, rawScore) : 0;
      const payload =
        record.payload && typeof record.payload === 'object'
          ? (record.payload as Record<string, unknown>)
          : null;
      return { id: String(record.id ?? ''), score, payload };
    });
  }

  async deleteByIds(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const response = await this.request(
      'POST',
      `/collections/${this.o.collection}/points/delete`,
      { points: [...ids] },
    );
    this.expectOk(response, 'delete');
  }

  async collectionInfo(): Promise<QdrantCollectionInfo | null> {
    const response = await this.request('GET', `/collections/${this.o.collection}`);
    if (!response.ok) {
      return null;
    }
    const raw = (await response.json()) as {
      result?: { status?: unknown; points_count?: unknown; segments_count?: unknown };
    };
    const result = raw.result;
    if (!result) return null;
    return {
      status: String(result.status ?? 'unknown'),
      pointsCount: typeof result.points_count === 'number' ? result.points_count : 0,
      segmentsCount: typeof result.segments_count === 'number' ? result.segments_count : 0,
    };
  }

  // --- internals ---------------------------------------------------------

  private expectOk(response: Response, what: string): void {
    if (!response.ok) {
      throw new KnowledgeStoreUnavailableError(
        `vector store ${what} failed (http ${response.status})`,
      );
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.o.timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(`${this.o.baseUrl}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(this.o.apiKey ? { 'api-key': this.o.apiKey } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new KnowledgeStoreUnavailableError(
            `vector store timed out after ${this.o.timeoutMs}ms`,
          );
        }
        throw new KnowledgeStoreUnavailableError('vector store network failure', error);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
}