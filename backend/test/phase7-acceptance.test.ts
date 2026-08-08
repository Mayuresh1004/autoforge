/**
 * Phase 7 acceptance — headless end-to-end of the knowledge pipeline:
 *
 *   NVD fixture → normalize → CVERecord (repo) → KnowledgeDocument →
 *   EmbeddingProvider → vector store → RAG retrieval (relevant docs first)
 *
 * plus PromptRegistry (real agents/prompts templates) and AgentScanContext
 * (usable by a future Engineer). No network, no Docker, no live APIs.
 */

import { describe, expect, it } from 'vitest';
import { FileSystemPromptRegistry, resolvePromptsRoot } from '../src/prompts/infrastructure/fs-prompt-registry';
import { normalizeNvdItem, type RawNvdVulnerability } from '../src/knowledge/application/services/cve-normalizer';
import { DefaultCveIngestionService } from '../src/knowledge/application/services/cve-ingestion.service';
import { RagService } from '../src/knowledge/application/services/rag.service';
import type { KnowledgeFetchResult, KnowledgeSource } from '../src/knowledge/domain/ports/knowledge-source';
import { createAgentScanContext } from '../src/agent/domain/models/agent-scan-context';
import { MemoryCveRepository } from './helpers/memory-cve-repository';
import { MemoryKnowledgeVectorStore } from './helpers/memory-knowledge-vector-store';
import { DeterministicEmbeddingProvider } from './helpers/deterministic-embedding';

const NVD_FIXTURE: RawNvdVulnerability[] = [
  {
    id: 'CVE-2024-1280',
    descriptions: [{ lang: 'en', value: 'SQL injection in a Python Flask web app: raw string concatenation when building the database query.' }],
    published: '2024-03-01T00:00:00Z',
    lastModified: '2024-03-05T00:00:00Z',
    metrics: { cvssMetricV31: [{ cvssData: { baseScore: 9.8, vectorString: 'CVSS:3.1/AV:N/AC:L' } }] },
    weaknessEnumeration: [{ description: [{ value: 'CWE-89' }] }],
    references: [{ url: 'https://advisory.example/CVE-2024-1280' }],
  },
  {
    id: 'CVE-2024-1281',
    descriptions: [{ lang: 'en', value: 'Cross-site scripting in a React rating widget rendering attacker-controlled props.' }],
    published: '2024-03-02T00:00:00Z',
    lastModified: '2024-03-06T00:00:00Z',
    metrics: { cvssMetricV31: [{ cvssData: { baseScore: 6.1, vectorString: 'CVSS:3.1/AV:N/AC:L' } }] },
    weaknessEnumeration: [{ description: [{ value: 'CWE-79' }] }],
    references: [{ url: 'https://advisory.example/CVE-2024-1281' }],
  },
];

class FixtureSource implements KnowledgeSource {
  private readonly items: readonly RawNvdVulnerability[];
  constructor(items: readonly RawNvdVulnerability[]) {
    this.items = items;
  }
  getName(): string {
    return 'nvd';
  }
  getType(): 'nvd' {
    return 'nvd';
  }
  async fetch(): Promise<KnowledgeFetchResult> {
    const documents = [];
    let malformed = 0;
    for (const item of this.items) {
      try {
        documents.push(normalizeNvdItem(item).document);
      } catch {
        malformed += 1;
      }
    }
    return { documents, hasMore: false, malformed };
  }
}

describe('Phase 7 acceptance', () => {
  it('runs the full pipeline: NVD fixture → CVERecord → embedding → store → RAG', async () => {
    const repo = new MemoryCveRepository();
    const store = new MemoryKnowledgeVectorStore();
    const embedding = new DeterministicEmbeddingProvider(64);

    const service = new DefaultCveIngestionService({
      source: new FixtureSource(NVD_FIXTURE),
      cveRepository: repo,
      embeddingProvider: embedding,
      vectorStore: store,
    });

    const summary = await service.ingest({ maxItems: 10 });
    expect(summary.inserted).toBe(2);
    expect(summary.embedded).toBe(2);
    expect(repo.count()).toBe(2);
    expect(store.count()).toBe(2);

    const rag = new RagService({
      embeddingProvider: embedding,
      vectorStore: store,
      contentRepository: repo,
    });

    const sqlInjection = await rag.search({
      query: 'How do I fix SQL injection in Flask?',
      topK: 3,
    });
    expect(sqlInjection.documents[0]?.externalId).toBe('CVE-2024-1280');
    expect(sqlInjection.documents[0]?.content).toContain('SQL injection');

    const xss = await rag.search({ query: 'cross site scripting react', topK: 3 });
    expect(xss.documents[0]?.externalId).toBe('CVE-2024-1281');
  });

  it('keeps the pipeline idempotent across a second run', async () => {
    const repo = new MemoryCveRepository();
    const store = new MemoryKnowledgeVectorStore();
    const service = new DefaultCveIngestionService({
      source: new FixtureSource(NVD_FIXTURE),
      cveRepository: repo,
      embeddingProvider: new DeterministicEmbeddingProvider(64),
      vectorStore: store,
    });
    const first = await service.ingest();
    const second = await service.ingest();
    expect(first.inserted).toBe(2);
    expect(second.updated).toBe(2);
    expect(second.inserted).toBe(0);
    expect(store.count()).toBe(2);
  });

  it('PromptRegistry loads the four real engineer templates from disk', async () => {
    const root = resolvePromptsRoot(process.env.PROMPTS_ROOT);
    const registry = new FileSystemPromptRegistry(root);
    for (const id of [
      'engineer.system',
      'engineer.patch-generation',
      'engineer.rag-context',
      'engineer.security-review',
    ] as const) {
      const content = await registry.get(id);
      expect(content.trim().length).toBeGreaterThan(0);
    }
  });

  it('AgentScanContext is usable by a future agent without Docker internals', () => {
    const context = createAgentScanContext({
      scanId: 'scan-9',
      repository: { url: 'https://github.com/acme/flask-app' },
      staticFindings: [
        {
          id: 'f-1',
          title: 'SQLi',
          description: 'concat',
          severity: 'HIGH',
          ruleId: 'bandit.B608',
          filePath: 'app.py',
          cveId: 'CVE-2024-1280',
        },
      ],
      attackSurface: [{ id: 't-1', url: 'http://localhost:3000/login' }],
      verifiedExploits: [],
    });
    expect(context.scanId).toBe('scan-9');
    expect(context.createdAt).toBeTruthy();
    expect(JSON.stringify(context)).toContain('flask-app');
  });
});