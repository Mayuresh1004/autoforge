import path from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { RagService } from './rag.service';
import { DefaultCveIngestionService } from './cve-ingestion.service';
import { LocalKnowledgeSource } from '../../infrastructure/sources/local-knowledge-source';
import { MemoryCveRepository } from '../../../../test/helpers/memory-cve-repository';
import { MemoryKnowledgeVectorStore } from '../../../../test/helpers/memory-knowledge-vector-store';
import { DeterministicEmbeddingProvider } from '../../../../test/helpers/deterministic-embedding';

describe('RAG Retrieval Validation — 4 Vulnerability Classes', () => {
  let rag: RagService;
  let cveRepository: MemoryCveRepository;
  let vectorStore: MemoryKnowledgeVectorStore;

  beforeAll(async () => {
    const dirPath = path.resolve(process.cwd(), 'data/knowledge');
    const source = new LocalKnowledgeSource({ dirPath });
    cveRepository = new MemoryCveRepository();
    vectorStore = new MemoryKnowledgeVectorStore();
    const embeddingProvider = new DeterministicEmbeddingProvider(64);

    const ingestionService = new DefaultCveIngestionService({
      source,
      cveRepository,
      embeddingProvider,
      vectorStore,
    });

    // Run end-to-end ingestion pipeline: files → source → ingestion → repository & vectors
    const summary = await ingestionService.ingest();
    expect(summary.fetched).toBeGreaterThanOrEqual(20);
    expect(summary.embedded).toBeGreaterThanOrEqual(20);

    rag = new RagService({
      embeddingProvider,
      vectorStore,
      contentRepository: cveRepository,
    });
  });

  it('Test 1: File Upload — CWE-434 retrieval and evidence criteria', async () => {
    const query =
      'An Express endpoint accepts multipart uploads using multer and writes req.file.originalname into a public uploads directory. What evidence is required before confirming CWE-434?';
    
    const result = await rag.search({
      query,
      topK: 5,
      filters: { vulnerabilityType: 'FILE_UPLOAD' },
    });

    expect(result.documents.length).toBeGreaterThan(0);
    
    const topDoc = result.documents[0];
    expect(topDoc.vulnerabilityType).toBe('FILE_UPLOAD');
    expect(topDoc.externalId).toBe('CWE-434');

    // Verify metadata preservation
    expect(topDoc.id).toMatch(/^kb:FILE-UPLOAD-/);

    // Verify actual retrieved content contains required criteria
    const allContent = result.documents.map((d) => d.content).join('\n');
    expect(allContent).toContain('Suspicious Code');
    expect(allContent).toContain('Potential Vulnerability');
    expect(allContent).toContain('Confirmed Exploitability');
    expect(allContent).toContain('Payload Acceptance');
    expect(allContent).toContain('File Persistence');
    expect(allContent).toContain('Execution or Direct Reachability');
  });

  it('Test 2: SSRF — CWE-918 retrieval and verification thresholds', async () => {
    const query =
      'An Express endpoint passes req.body.url directly to axios.get. How should AMASS verify whether this is actually exploitable?';

    const result = await rag.search({
      query,
      topK: 5,
      filters: { vulnerabilityType: 'SSRF' },
    });

    expect(result.documents.length).toBeGreaterThan(0);

    const topDoc = result.documents[0];
    expect(topDoc.vulnerabilityType).toBe('SSRF');
    expect(topDoc.externalId).toBe('CWE-918');

    // Verify actual content criteria
    const allContent = result.documents.map((d) => d.content).join('\n');
    expect(allContent).toContain('Internal Service Access');
    expect(allContent).toContain('Out-of-Band');
    expect(allContent).toContain('127.0.0.1');
    expect(allContent).toContain('169.254.169.254');
  });

  it('Test 3: XSS — CWE-79 retrieval and response criteria', async () => {
    const query =
      'A search endpoint reflects req.query.q into a text/html response without escaping. What evidence is required to confirm XSS?';

    const result = await rag.search({
      query,
      topK: 5,
      filters: { vulnerabilityType: 'XSS' },
    });

    expect(result.documents.length).toBeGreaterThan(0);

    const topDoc = result.documents[0];
    expect(topDoc.vulnerabilityType).toBe('XSS');
    expect(topDoc.externalId).toBe('CWE-79');

    // Verify actual content criteria
    const allContent = result.documents.map((d) => d.content).join('\n');
    expect(allContent).toContain('Unescaped Output Execution Context');
    expect(allContent).toContain('text/html');
    expect(allContent).toContain('application/json');
  });

  it('Test 4: IDOR — CWE-639 / BROKEN_ACCESS_CONTROL multi-user criteria', async () => {
    const query =
      "User B requests User A's document by changing the document ID while authenticated as User B. What evidence confirms an IDOR?";

    const result = await rag.search({
      query,
      topK: 5,
      filters: { vulnerabilityType: 'BROKEN_ACCESS_CONTROL' },
    });

    expect(result.documents.length).toBeGreaterThan(0);

    const topDoc = result.documents[0];
    expect(topDoc.vulnerabilityType).toBe('BROKEN_ACCESS_CONTROL');
    expect(topDoc.externalId).toBe('CWE-639');

    // Verify actual content criteria
    const allContent = result.documents.map((d) => d.content).join('\n');
    expect(allContent).toContain('Multi-Tenant Context Authentication');
    expect(allContent).toContain('Cross-Boundary Resource Request');
    expect(allContent).toContain('Unauthorized Data Leakage');
  });

  it('Test 5: Retrieval Isolation — ensures zero cross-vulnerability leakage when filtered', async () => {
    const fileUploadResult = await rag.search({
      query: 'file upload vulnerability',
      filters: { vulnerabilityType: 'FILE_UPLOAD' },
    });
    for (const doc of fileUploadResult.documents) {
      expect(doc.vulnerabilityType).toBe('FILE_UPLOAD');
      expect(doc.externalId).toBe('CWE-434');
    }

    const ssrfResult = await rag.search({
      query: 'ssrf request forgery',
      filters: { vulnerabilityType: 'SSRF' },
    });
    for (const doc of ssrfResult.documents) {
      expect(doc.vulnerabilityType).toBe('SSRF');
      expect(doc.externalId).toBe('CWE-918');
    }

    const xssResult = await rag.search({
      query: 'cross site scripting',
      filters: { vulnerabilityType: 'XSS' },
    });
    for (const doc of xssResult.documents) {
      expect(doc.vulnerabilityType).toBe('XSS');
      expect(doc.externalId).toBe('CWE-79');
    }

    const idorResult = await rag.search({
      query: 'broken access control idor',
      filters: { vulnerabilityType: 'BROKEN_ACCESS_CONTROL' },
    });
    for (const doc of idorResult.documents) {
      expect(doc.vulnerabilityType).toBe('BROKEN_ACCESS_CONTROL');
      expect(doc.externalId).toBe('CWE-639');
    }
  });
});
