import { describe, expect, it } from 'vitest';
import { confirmedFinding } from '../../../../test/helpers/engineer-fakes';
import { buildRagQuery, languageFromPath, ragDocumentsToAdvisory } from './rag-query-builder';

describe('rag-query-builder', () => {
  it('builds a focused SQL injection query with language hint and file', () => {
    const query = buildRagQuery(confirmedFinding({ filePath: 'src/app.py', message: 'SQL injection in search', severity: 'HIGH' }));
    expect(query.query).toContain('python');
    expect(query.query).toContain('sql injection');
    expect(query.query).toContain('src/app.py');
    expect(query.query).toContain('SQL injection in search');
    expect(query.filters?.vulnerabilityType).toBe('SQL_INJECTION');
    expect(query.filters?.severity).toBe('HIGH');
  });

  it('caps topK at the requested bound', () => {
    const query = buildRagQuery(confirmedFinding(), { topK: 3 });
    expect(query.topK).toBe(3);
  });

  it('never filters by unknown severities', () => {
    const query = buildRagQuery(confirmedFinding({ severity: 'WEIRD' as never }));
    expect(query.filters?.severity).toBeUndefined();
    expect(query.filters?.vulnerabilityType).toBe('SQL_INJECTION');
  });

  it('falls back to a minimal query when nothing is available', () => {
    const query = buildRagQuery(confirmedFinding({ filePath: null, message: null }));
    expect(query.query.length).toBeGreaterThan(0);
    expect(query.query).toContain('sql injection');
  });

  it('maps common extensions to languages', () => {
    expect(languageFromPath('src/main/java/UserService.java')).toBe('java');
    expect(languageFromPath('app/server.ts')).toBe('typescript');
    expect(languageFromPath('queries.sql')).toBe('sql');
    expect(languageFromPath(null)).toBeNull();
  });

  it('renders retrieved docs as bounded advisory text (no payload internals)', () => {
    const advisory = ragDocumentsToAdvisory([
      {
        id: 'p1', externalId: 'CVE-2025-0001', title: 'SQLi in Python', content: 'x'.repeat(2_000),
        sourceType: 'nvd', vulnerabilityType: 'SQL_INJECTION', severity: 'HIGH', language: 'python', framework: 'flask',
        sourceUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2025-0001', score: 0.97,
      },
    ], 140, 120);
    expect(advisory).toContain('CVE-2025-0001');
    expect(advisory).toContain('0.970');
    expect(advisory.length).toBeLessThan(600);
    expect(advisory).not.toContain('"payload"');
  });

  it('renders an empty advisory when no docs were retrieved', () => {
    expect(ragDocumentsToAdvisory([])).toBe('');
  });
});