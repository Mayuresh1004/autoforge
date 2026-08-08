/**
 * RAGService — retrieval glue: query → validate → embed → vector search →
 * resolve full content (CVERecord description) → ranked documents. No
 * Qdrant/HTTP/embedding-provider types leak past this boundary.
 *
 * Security: retrieved knowledge is UNTRUSTED CONTEXT — never executed, never
 * able to override system instructions. Prompt assembly happens in the
 * (future) agent layer using the rag-context template, never here.
 */

import type { EmbeddingProvider } from '../../../embedding/domain/ports/embedding-provider';
import { KnowledgeError } from '../../domain/errors/knowledge.errors';
import type { KnowledgeSeverity, KnowledgeSourceType } from '../../domain/models/knowledge-document';
import type { CveRepository } from '../../domain/ports/cve-repository';
import type {
  KnowledgeSearchFilters,
  KnowledgeVectorStore,
} from '../../domain/ports/knowledge-vector-store';

export const RAG_QUERY_MAX_CHARS = 2_000;
export const RAG_TOP_K_MIN = 1;
export const RAG_TOP_K_MAX = 50;

export interface RagQuery {
  readonly query: string;
  readonly topK?: number;
  readonly filters?: RagFilters;
}

export interface RagFilters {
  readonly sourceType?: KnowledgeSourceType;
  readonly cveId?: string;
  readonly vulnerabilityType?: string;
  readonly severity?: KnowledgeSeverity;
  readonly language?: string;
  readonly framework?: string;
}

export interface RagResultDocument {
  readonly id: string;
  readonly externalId: string;
  readonly title: string;
  readonly content: string;
  readonly sourceType: KnowledgeSourceType;
  readonly vulnerabilityType: string | null;
  readonly severity: KnowledgeSeverity | null;
  readonly language: string | null;
  readonly framework: string | null;
  readonly sourceUrl: string | null;
  readonly score: number;
}

export interface RagResult {
  readonly query: string;
  readonly documents: RagResultDocument[];
}

export interface RagSearchDeps {
  readonly embeddingProvider: EmbeddingProvider;
  readonly vectorStore: KnowledgeVectorStore;
  /** Resolves full content for a retrieved document (CVERecord description). */
  readonly contentRepository: CveRepository;
}

export class RagValidationError extends KnowledgeError {
  constructor(detail: string) {
    super('RAG_VALIDATION', detail);
    this.name = 'RagValidationError';
  }
}

export class RagService {
  private readonly deps: RagSearchDeps;

  constructor(deps: RagSearchDeps) {
    this.deps = deps;
  }

  async search(query: RagQuery): Promise<RagResult> {
    const { text, topK, filters } = validateQuery(query);
    const embedding = await this.deps.embeddingProvider.embedText(text);
    const hits = await this.deps.vectorStore.search(embedding, { topK, filters });
    const documents = await Promise.all(hits.map((hit) => this.toDocument(hit)));
    return { query: text, documents };
  }

  // --- internals ---------------------------------------------------------

  private async toDocument(hit: {
    readonly id: string;
    readonly score: number;
    readonly payload: KnowledgeSearchHitPayload | null;
  }): Promise<RagResultDocument> {
    const payload = hit.payload ?? null;
    const cveId = payload?.cveId ?? null;
    const record = cveId ? await this.deps.contentRepository.findByCveId(cveId) : null;
    return {
      id: hit.id,
      externalId: cveId ?? hit.id,
      title: cveId ?? hit.id,
      content: record?.description ?? '',
      sourceType: payload?.sourceType ?? 'nvd',
      vulnerabilityType: payload?.vulnerabilityType ?? null,
      severity: payload?.severity ?? null,
      language: payload?.language ?? null,
      framework: payload?.framework ?? null,
      sourceUrl: payload?.sourceUrl ?? null,
      score: hit.score,
    };
  }
}

interface KnowledgeSearchHitPayload {
  readonly sourceType: KnowledgeSourceType;
  readonly cveId: string | null;
  readonly vulnerabilityType: string | null;
  readonly severity: KnowledgeSeverity | null;
  readonly language: string | null;
  readonly framework: string | null;
  readonly sourceUrl: string | null;
}

function validateQuery(query: RagQuery): { text: string; topK: number; filters?: KnowledgeSearchFilters } {
  const text = typeof query.query === 'string' ? query.query.trim() : '';
  if (text.length === 0) {
    throw new RagValidationError('query is required');
  }
  if (text.length > RAG_QUERY_MAX_CHARS) {
    throw new RagValidationError(`query exceeds ${RAG_QUERY_MAX_CHARS} characters`);
  }
  const topK = query.topK ?? 5;
  if (!Number.isInteger(topK) || topK < RAG_TOP_K_MIN || topK > RAG_TOP_K_MAX) {
    throw new RagValidationError(`topK must be an integer between ${RAG_TOP_K_MIN} and ${RAG_TOP_K_MAX}`);
  }
  return { text, topK, filters: query.filters };
}