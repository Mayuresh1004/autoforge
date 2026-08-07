import { describe, it, expect } from 'vitest';
import type { Severity } from '../../domain/models/severity';
import type { RawFinding } from '../../domain/models/finding';
import { FindingNormalizer } from './normalizer';

const base: RawFinding = {
  type: 'SQL_INJECTION',
  severity: 'HIGH',
  confidence: null,
  file: 'src/app.ts',
  line: 42,
  message: 'Possible SQL injection.',
  cwe: 'CWE-89',
  cve: null,
  references: ['https://example.com/a'],
  evidence: 'query(...)',
};

function normalizer(threshold: Severity): FindingNormalizer {
  return new FindingNormalizer({
    scannerId: 'semgrep',
    engine: 'Semgrep',
    defaultConfidence: 0.7,
    severityThreshold: threshold,
  });
}

describe('FindingNormalizer', () => {
  it('produces a deterministic, stable id for identical inputs', () => {
    const a = normalizer('INFO').normalize(base, 'scan_1');
    const b = normalizer('INFO').normalize(base, 'scan_2');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a?.id).toBe(b?.id);
    expect(a?.id).toMatch(/^vuln_[0-9a-f]{12}$/);
  });

  it('maps severity, fills default confidence, and fallback message', () => {
    const finding = normalizer('INFO').normalize(base, 'scan_1');
    expect(finding).toMatchObject({ severity: 'HIGH', confidence: 0.7, createdAt: expect.any(String) });
  });

  it('uses provided confidence when the tool supplies one, clamped to 0..1', () => {
    expect(normalizer('INFO').normalize({ ...base, confidence: 1.5 }, 's')?.confidence).toBe(1);
    expect(normalizer('INFO').normalize({ ...base, confidence: -0.2 }, 's')?.confidence).toBe(0);
  });

  it('drops findings below the severity threshold', () => {
    const low = normalizer('MEDIUM').normalize({ ...base, severity: 'LOW' }, 's');
    expect(low).toBeNull();
    const high = normalizer('MEDIUM').normalize(base, 's');
    expect(high).not.toBeNull();
  });

  it('deduplicates references and falls back type as message', () => {
    const finding = normalizer('INFO').normalize(
      { ...base, message: null, references: ['a', 'b', 'a'] },
      's'
    );
    expect(finding?.message).toBe(base.type);
    expect(finding?.references).toEqual(['a', 'b']);
  });
});