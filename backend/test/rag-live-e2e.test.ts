/**
 * Opt-in LIVE knowledge E2Es. Skipped by default — the default suite must
 * pass with no keys, no Docker Qdrant, no network access to NVD.
 *
 * Enable individually:
 *   RAG_NVD_E2E=1        real NVD fetch of a small bounded window
 *   RAG_EMBEDDING_E2E=1  real Gemini embeddings (GEMINI_API_KEY)
 *   RAG_QDRANT_E2E=1     real Qdrant at KNOWLEDGE_QDRANT_URL
 *
 * These compose: with all three set, a full live ingest→RAG run executes.
 */

import { describe, expect, it } from 'vitest';
import { embeddingConfig, knowledgeConfig } from '../src/config';
import { createEmbeddingProvider } from '../src/embedding/infrastructure/factory/embedding-provider-factory';
import { NvdKnowledgeSource } from '../src/knowledge/infrastructure/sources/nvd-knowledge-source';
import { QdrantClient } from '../src/knowledge/infrastructure/qdrant/qdrant-client';
import { QdrantKnowledgeStore } from '../src/knowledge/infrastructure/store/qdrant-knowledge-store';
import { RagService } from '../src/knowledge/application/services/rag.service';
import { MemoryCveRepository } from './helpers/memory-cve-repository';

function skipUnless(env: string): boolean {
  return process.env[env] !== '1';
}

describe('RAG live providers (opt-in)', () => {
  it('ingests a bounded NVD window against the real API', async () => {
    if (skipUnless('RAG_NVD_E2E')) return;
    const source = new NvdKnowledgeSource(knowledgeConfig.nvd);
    const result = await source.fetch({ maxItems: 5 });
    expect(result.documents.length).toBeGreaterThan(0);
    for (const document of result.documents) {
      expect(document.sourceType).toBe('nvd');
      expect(document.externalId).toMatch(/^CVE-\d{4}-\d+$/i);
      expect(document.content.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('embeds text via the real Gemini endpoint', async () => {
    if (skipUnless('RAG_EMBEDDING_E2E')) return;
    const provider = createEmbeddingProvider(embeddingConfig);
    const vector = await provider.embedText('SQL injection in Flask');
    expect(vector).toHaveLength(embeddingConfig.dimensions);
    expect(vector.every((component) => typeof component === 'number')).toBe(true);
  }, 60_000);

  it('stores and retrieves a vector against real Qdrant', async () => {
    if (skipUnless('RAG_QDRANT_E2E')) return;
    const client = new QdrantClient({
      baseUrl: knowledgeConfig.qdrant.baseUrl,
      apiKey: knowledgeConfig.qdrant.apiKey,
      timeoutMs: knowledgeConfig.qdrant.timeoutMs,
      collection: `amass_e2e_${process.pid}`,
    });
    const store = new QdrantKnowledgeStore({ client, dimensions: embeddingConfig.dimensions });
    await store.ensureCollection();
    await store.upsert([
      {
        id: 'cve:e2e',
        embedding: new Array(embeddingConfig.dimensions).fill(0.5),
        payload: {
          sourceType: 'nvd',
          cveId: 'CVE-2024-E2E0',
          vulnerabilityType: null,
          severity: null,
          language: null,
          framework: null,
          sourceUrl: null,
        },
      },
    ]);
    const rag = new RagService({
      embeddingProvider: {
        dimensions: () => embeddingConfig.dimensions,
        embedText: async () => new Array(embeddingConfig.dimensions).fill(0.5),
        embedBatch: async (texts) => texts.map(() => new Array(embeddingConfig.dimensions).fill(0.5)),
      },
      vectorStore: store,
      contentRepository: new MemoryCveRepository(),
    });
    const result = await rag.search({ query: 'e2e probe', topK: 1 });
    expect(result.documents).toHaveLength(1);
    await store.delete(['cve:e2e']);
    expect(await client.collectionInfo()).not.toBeNull();
  }, 120_000);
});