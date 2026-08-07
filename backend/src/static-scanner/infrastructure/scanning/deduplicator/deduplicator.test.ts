import { describe, it, expect } from 'vitest';
import type { UnifiedFinding } from '../../domain/models/finding';
import { KeyedFindingDeduplicator } from './deduplicator';

function finding(partial: Partial<UnifiedFinding>): UnifiedFinding {
  return {
    id: 'vuln_x',
    scanner: 'A',
    type: 'SQLI',
    severity: 'HIGH',
    confidence: 0.8,
    file: 'src/a.ts',
    line: 10,
    message: 'm',
    cwe: null,
    cve: null,
    references: [],
    evidence: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('KeyedFindingDeduplicator', () => {
  it('drops duplicates sharing file+line+type+severity', () => {
    const result = new KeyedFindingDeduplicator().deduplicate([
      finding({ scanner: 'Bandit', type: 'SQLI' }),
      finding({ scanner: 'Semgrep', type: 'SQLI', confidence: 0.9 }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].scanner).toBe('Semgrep'); // higher confidence wins
  });

  it('keeps findings that differ only in severity or type', () => {
    const result = new KeyedFindingDeduplicator().deduplicate([
      finding({ severity: 'HIGH' }),
      finding({ severity: 'LOW' }), // same file/line/type, different severity
      finding({ type: 'XSS' }), // different type
    ]);
    expect(result).toHaveLength(3);
  });

  it('merges references across duplicates', () => {
    const result = new KeyedFindingDeduplicator().deduplicate([
      finding({ references: ['https://a'] }),
      finding({ references: ['https://b'] }),
    ]);
    expect(result[0].references).toEqual(['https://a', 'https://b']);
  });

  it('is deterministic and stable in output order', () => {
    const diff = new KeyedFindingDeduplicator().deduplicate([
      finding({ type: 'B', id: 'vuln_2' }),
      finding({ type: 'A', id: 'vuln_1' }),
    ]);
    expect(diff.map((f) => f.id)).toEqual(['vuln_1', 'vuln_2']);
  });
});