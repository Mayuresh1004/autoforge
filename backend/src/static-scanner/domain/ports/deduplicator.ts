import type { UnifiedFinding } from '../models/finding';

/**
 * Removes duplicate findings across scanners. Strategy is deterministic and
 * driven by (file, line, type, severity). Implementations must never drop a
 * finding of higher confidence, and output order must be stable.
 */
export interface FindingDeduplicator {
  deduplicate(findings: readonly UnifiedFinding[]): readonly UnifiedFinding[];
}