import type { UnifiedFinding } from '../../../domain/models/finding';
import type { FindingDeduplicator } from '../../../domain/ports/deduplicator';

function keyOf(finding: UnifiedFinding): string {
  return [finding.file ?? '', String(finding.line ?? ''), finding.type, finding.severity].join('|');
}

/**
 * Deterministic cross-scanner deduplication keyed on (file, line, type,
 * severity). When two scanners agree, the higher-confidence finding wins;
 * ties resolve by scanner id (stable order). References are merged.
 */
export class KeyedFindingDeduplicator implements FindingDeduplicator {
  deduplicate(findings: readonly UnifiedFinding[]): readonly UnifiedFinding[] {
    const winners = new Map<string, UnifiedFinding>();

    for (const finding of findings) {
      const key = keyOf(finding);
      const existing = winners.get(key);
      if (!existing) {
        winners.set(key, finding);
        continue;
      }
      if (this.shouldReplace(existing, finding)) {
        winners.set(key, this.merge(existing, finding));
      } else {
        // Keep the survivor but accumulate references from the duplicate.
        winners.set(key, {
          ...existing,
          references: unique([...existing.references, ...finding.references]),
        });
      }
    }

    return [...winners.values()].sort(this.sortByDeterministicOrder);
  }

  private shouldReplace(existing: UnifiedFinding, candidate: UnifiedFinding): boolean {
    if (candidate.confidence !== existing.confidence) {
      return candidate.confidence > existing.confidence;
    }
    return candidate.scanner < existing.scanner;
  }

  private merge(existing: UnifiedFinding | undefined, candidate: UnifiedFinding): UnifiedFinding {
    if (!existing) return candidate;
    const refs = unique([...existing.references, ...candidate.references]);
    return {
      ...candidate,
      references: refs,
      cwe: candidate.cwe ?? existing.cwe,
      cve: candidate.cve ?? existing.cve,
      message: candidate.message,
      evidence: candidate.evidence ?? existing.evidence,
    };
  }

  private sortByDeterministicOrder(a: UnifiedFinding, b: UnifiedFinding): number {
    return a.id.localeCompare(b.id);
  }
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}