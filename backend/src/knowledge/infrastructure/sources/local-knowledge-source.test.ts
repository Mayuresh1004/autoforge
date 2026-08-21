import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalKnowledgeSource } from './local-knowledge-source';

describe('LocalKnowledgeSource', () => {
  it('fetches and parses all markdown knowledge documents from data/knowledge', async () => {
    const dirPath = path.resolve(process.cwd(), 'data/knowledge');
    const source = new LocalKnowledgeSource({ dirPath });

    const result = await source.fetch();
    expect(result.documents.length).toBeGreaterThanOrEqual(20);
    expect(result.malformed).toBe(0);

    const ids = result.documents.map((d) => d.id);
    expect(ids).toContain('kb:FILE-UPLOAD-01');
    expect(ids).toContain('kb:SSRF-01');
    expect(ids).toContain('kb:XSS-01');
    expect(ids).toContain('kb:IDOR-01');

    const sample = result.documents.find((d) => d.id === 'kb:FILE-UPLOAD-01');
    expect(sample).toBeDefined();
    expect(sample?.externalId).toBe('CWE-434');
    expect(sample?.vulnerabilityType).toBe('FILE_UPLOAD');
    expect(sample?.content).toContain('Insecure File Upload');
  });
});
