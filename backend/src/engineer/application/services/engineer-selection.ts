/**
 * Deterministic confirmed-SQLi selection for the Engineer. The API may run
 * the Engineer on ONE finding; when no vulnerabilityId is given, this picks
 * the single highest-priority candidate.
 *
 * Rule (documented in README/PROGRESS):
 *   1. CONFIRMED + SQL_INJECTION only — confidence is advisory and NEVER
 *      overrides confirmed status.
 *   2. severity (CRITICAL > HIGH > MEDIUM > LOW > INFO)
 *   3. confidence (higher first; advisory ordering inside the same severity)
 *   4. exploit depth (more recorded verification attempts first)
 *   5. stable tie-breaker: lexicographically smallest vulnerabilityId
 *
 * Selection is deterministic: same input, same output, no RNG.
 */

import type { ConfirmedVulnerabilityFinding } from '../../domain/ports/confirmed-finding-repository';

const SEVERITY_RANK: Readonly<Record<string, number>> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

/** Only ever select a CONFIRMED SQL injection finding. */
export function isSupportedConfirmedFinding(f: ConfirmedVulnerabilityFinding): boolean {
  return f.status === 'CONFIRMED' && f.type === 'SQL_INJECTION';
}

export function compareCandidates(a: ConfirmedVulnerabilityFinding, b: ConfirmedVulnerabilityFinding): number {
  const severityA = SEVERITY_RANK[a.severity] ?? 0;
  const severityB = SEVERITY_RANK[b.severity] ?? 0;
  if (severityA !== severityB) return severityB - severityA;

  const confA = typeof a.confidence === 'number' ? a.confidence : 0;
  const confB = typeof b.confidence === 'number' ? b.confidence : 0;
  if (confA !== confB) return confB - confA;

  const depthA = a.exploitDepth ?? 0;
  const depthB = b.exploitDepth ?? 0;
  if (depthA !== depthB) return depthB - depthA;

  return a.vulnerabilityId.localeCompare(b.vulnerabilityId);
}

/** Pick the highest-priority supported candidate, or null when none apply. */
export function selectConfirmedSqlInjection(
  candidates: readonly ConfirmedVulnerabilityFinding[],
): ConfirmedVulnerabilityFinding | null {
  const supported = candidates.filter(isSupportedConfirmedFinding);
  if (supported.length === 0) return null;
  const sorted = [...supported].sort(compareCandidates);
  return sorted[0];
}