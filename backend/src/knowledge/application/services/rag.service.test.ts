import { describe, expect, it } from 'vitest';
import { RagService, RagValidationError } from './rag.service';
import { MemoryCveRepository } from '../../../../test/helpers/memory-cve-repository';
import { MemoryKnowledgeVectorStore } from '../../../../test/helpers/memory-knowledge-vector-store';
import { DeterministicEmbeddingProvider } from '../../../../test/helpers/deterministic-embedding';
import type { VectorPoint } from '../../domain/ports/knowledge-vector-store';

function vector(cveId: string, type: string, severity: string): VectorPoint {
  return {
    id: `cve:${cveId}`,
    embedding: new Array(8).fill(0),
    payload: {
      sourceType: 'nvd',
      cveId,
      vulnerabilityType: type,
      severity: severity as VectorPoint['payload']['severity'],
      language: null,
      framework: null,
      sourceUrl: `https://nvd.example/vuln/detail/${cveId}`,
    },
  };
}

function makeService(store: MemoryKnowledgeVectorStore) {
  const cveRepository = new MemoryCveRepository();
  return {
    rag: new RagService({
      embeddingProvider: new DeterministicEmbeddingProvider(8),
      vectorStore: store,
      contentRepository: cveRepository,
    }),
    cveRepository,
  };
}

/** Retrieval-quality fixture: SQL injection in Python Flask among lookalike
 *  and unrelated documents. Deliberately small + deterministic so ranking is
 *  an exact, repeatable assertion. */
function qualityFixture(store: MemoryKnowledgeVectorStore, cves: MemoryCveRepository) {
  const embedding = new DeterministicEmbeddingProvider(64);
  const entries: Array<{ cve: string; content: string; type: string }> = [
    {
      cve: 'CVE-2025-1001',
      content:
        'SQL injection in a Python Flask application: unsanitized string concatenation in the database query',
      type: 'CWE-89',
    },
    {
      cve: 'CVE-2025-1002',
      content: 'SQL injection in a Python Django ORM misuse allowing query parameter manipulation',
      type: 'CWE-89',
    },
    {
      cve: 'CVE-2025-1003',
      content: 'Cross-site scripting in a React client: dangerouslySetInnerHTML with unescaped props',
      type: 'CWE-79',
    },
    {
      cve: 'CVE-2025-1004',
      content: 'Insecure deserialization in Java OkHttp cache poisoning',
      type: 'CWE-502',
    },
  ];
  for (const entry of entries) {
    cves.upsert({
      cveId: entry.cve,
      description: entry.content,
      severity: 'HIGH',
      cvssScore: 8.0,
      cvssVector: null,
      publishedAt: null,
      modifiedAt: null,
      references: [],
    });
    store.upsert([
      {
        ...vector(entry.cve, entry.type, 'HIGH'),
        embedding: embedding.embedText(entry.content),
      },
    ]);
  }
}

describe('RagService', () => {
  it('validates: rejects empty query', async () => {
    const { rag } = makeService(new MemoryKnowledgeVectorStore());
    await expect(rag.search({ query: '   ' })).rejects.toBeInstanceOf(RagValidationError);
  });

  it('validates: rejects over-long query', async () => {
    const { rag } = makeService(new MemoryKnowledgeVectorStore());
    await expect(rag.search({ query: 'x'.repeat(2001) })).rejects.toBeInstanceOf(
      RagValidationError,
    );
  });

  it('validates: rejects out-of-range topK', async () => {
    const { rag } = makeService(new MemoryKnowledgeVectorStore());
    await expect(rag.search({ query: 'x', topK: 0 })).rejects.toBeInstanceOf(RagValidationError);
    await expect(rag.search({ query: 'x', topK: 51 })).rejects.toBeInstanceOf(RagValidationError);
  });

  it('returns ranked results that include full content from the CVE record', async () => {
    const store = new MemoryKnowledgeVectorStore();
    const { rag, cveRepository } = makeService(store);
    qualityFixture(store, cveRepository);
    const result = await rag.search({ query: 'SQL injection in Python Flask', topK: 4 });
    expect(result.documents).toHaveLength(4);
    expect(result.documents[0].externalId).toBe('CVE-2025-1001');
    expect(result.documents[0].content).toContain('SQL injection');
    // Scores descending.
    const scores = result.documents.map((d) => d.score);
    expect([...scores].every((s, i) => i === 0 || s <= scores[i - 1])).toBe(true);
  });

  it('filers by severity and vulnerability type', async () => {
    const store = new MemoryKnowledgeVectorStore();
    const { rag, cveRepository } = makeService(store);
    const docCVE = vector('CVE-2025-1999', 'CWE-79', 'MEDIUM');
    store.upsert([vector('CVE-2025-1001', 'CWE-89', 'HIGH'), docCVE]);
    const highOnly = await rag.search({ query: 'xss', filters: { severity: 'HIGH' } });
    expect(highOnly.documents.every((d) => d.severity === 'HIGH')).toBe(true);
    const filteredByType = await rag.search({
      query: 'xss',
      filters: { vulnerabilityType: 'CWE-79' },
    });
    expect(filteredByType.documents[0]?.externalId).toBe('CVE-2025-1999');
  });

  it('filters by cveId', async () => {
    const store = new MemoryKnowledgeVectorStore();
    const { rag, cveRepository } = makeService(store);
    qualityFixture(store, cveRepository);
    const result = await rag.search({ query: 'anything', topK: 4, filters: { cveId: 'CVE-2025-1003' } });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].externalId).toBe('CVE-2025-1003');
  });

  it('deduplicates identical documents upserted twice (single hit per id)', async () => {
    const store = new MemoryKnowledgeVectorStore();
    for (let i = 0; i < 3; i += 1) {
      store.upsert([vector('CVE-2025-1001', 'CWE-89', 'HIGH')]);
    }
    const { rag, cveRepository } = makeService(store);
    qualityFixture(store, cveRepository); // add the others (upsert same key keeps one point)
    const result = await rag.search({ query: 'SQL injection', topK: 10 });
    const ids = result.documents.map((d) => d.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not leak vector-store/provider types to callers', async () => {
    const store = new MemoryKnowledgeVectorStore();
    const { rag, cveRepository } = makeService(store);
    qualityFixture(store, cveRepository);
    const result = await rag.search({ query: 'SQL injection in Python Flask', topK: 2 });
    const sample = result.documents[0];
    expect(sample).toHaveProperty('externalId');
    expect(sample).toHaveProperty('content');
    expect(sample).toHaveProperty('score');
    // No qdrant/embedding/provider fields may leak.
    expect('vector' in sample).toBe(false);
    expect('payload' in sample).toBe(false);
  });
});