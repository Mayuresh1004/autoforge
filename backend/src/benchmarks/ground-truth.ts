/**
 * Ground-truth matching engine (research artifact).
 *
 * Maps pipeline outputs (CONFIRMED Exploits, DETECTED Vulnerabilities,
 * discovered surfaces) onto the benchmark corpus and computes the paper's
 * headline metrics: detection recall/precision/F1 per CWE, static-surface
 * recall, recon completeness and remediation quality.
 *
 * Matching is deterministic and conservative:
 *  - an exploit matches a corpus finding only when BOTH the type/cwe identity
 *    and at least one normalized route agree (method + path template + the
 *    injection parameter when both sides specify one);
 *  - confirmed exploits that match no corpus finding are false positives
 *    (they are real findings, but out of the ground-truth set — reviewers
 *    must be told the corpus is finite, not exhaustive);
 *  - `future`-scoped findings are never scored: they are the documented
 *    known-but-not-yet-verifiable set.
 */

import type { CorpusApp, FindingSpec, RouteSpec } from './corpus';

export type ExploitStatus = 'CONFIRMED' | 'EXPLOITABLE' | 'NOT_CONFIRMED' | 'INCONCLUSIVE' | 'FAILED' | 'NOT_TESTED' | 'TESTING';

/** Durable Exploit row, reduced to the fields the matcher needs. */
export interface ExploitView {
  readonly id: string;
  readonly endpoint: string;
  readonly method: string;
  readonly parameter: string | null;
  /** Exploit.vulnerabilityType (canonical, e.g. SQL_INJECTION). */
  readonly vulnerabilityType: string | null;
  /** Joining Vulnerability.cweId when the exploit correlates to a finding. */
  readonly cweId: string | null;
  readonly status: ExploitStatus;
}

/** Durable Vulnerability row (static-scanner surface), reduced. */
export interface VulnerabilityView {
  readonly id: string;
  readonly cweId: string | null;
  readonly vulnType: string | null;
  readonly status: string;
  readonly filePath: string | null;
}

/** A discovered endpoint from ScoutScan.attackSurfaces. */
export interface SurfaceView {
  readonly url: string;
  readonly method: string;
}

const PARAM_SEGMENT = /^(:[\w-]+|\{[\w-]+\}|<[\w-]+>)$/;
const ID_LIKE =
  /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24})$/i;

/**
 * Path → canonical template: strips query/fragment, lowercases literal
 * segments, and collapses id-like segments (`:id`, `{id}`, `<id>`, digits,
 * uuids, mongodb object ids) to `:param`.
 */
export function normalizeRoutePath(path: string): string {
  let p = path.split('?')[0]?.split('#')[0]?.trim() ?? '';
  if (p === '') return '/';
  // Endpoints may be absolute URLs — keep only the path portion.
  const schemeHost = /^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/.*)?$/i.exec(p);
  if (schemeHost) p = schemeHost[1] ?? '/';
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  const segments = p.split('/').filter((s) => s.length > 0);
  const normalized = segments.map((s) => {
    if (PARAM_SEGMENT.test(s) || ID_LIKE.test(s)) return ':param';
    return s.toLowerCase();
  });
  return `/${normalized.join('/')}`;
}

/** Route overlap: same method + same normalized path (+ parameter agreement). */
export function routesOverlap(a: RouteSpec, b: { path: string; method: string; parameter?: string | null }): boolean {
  if (a.method.toUpperCase() !== b.method.toUpperCase()) return false;
  if (normalizeRoutePath(a.path) !== normalizeRoutePath(b.path)) return false;
  if (a.parameter && b.parameter && a.parameter.toLowerCase() !== b.parameter.toLowerCase()) return false;
  return true;
}

/** Does a corpus finding describe the same vulnerability as an exploit? */
export function findingMatchesExploit(finding: FindingSpec, exploit: ExploitView): boolean {
  const typeOk =
    (finding.vulnerabilityType !== undefined &&
      exploit.vulnerabilityType !== null &&
      finding.vulnerabilityType.toUpperCase() === exploit.vulnerabilityType.toUpperCase()) ||
    (exploit.cweId !== null && finding.cweId.toUpperCase() === exploit.cweId.toUpperCase());
  if (!typeOk) return false;
  const routes = finding.routes ?? [];
  if (routes.length === 0) return true; // no route hint: type identity suffices
  return routes.some((r) =>
    routesOverlap(r, { path: exploit.endpoint, method: exploit.method, parameter: exploit.parameter })
  );
}

/** Does a corpus finding match a static-scanner finding row? */
export function findingMatchesVulnerability(finding: FindingSpec, vuln: VulnerabilityView): boolean {
  if (vuln.cweId !== null && finding.cweId.toUpperCase() === vuln.cweId.toUpperCase()) {
    return true;
  }
  if (
    finding.vulnerabilityType !== undefined &&
    vuln.vulnType !== null &&
    finding.vulnerabilityType.toUpperCase() === vuln.vulnType.toUpperCase()
  ) {
    return true;
  }
  return false;
}

export interface FindingMatch {
  readonly finding: FindingSpec;
  readonly matchedBy: ExploitView | VulnerabilityView | null;
  readonly scope: FindingSpec['scope'];
}

export interface DetectionReport {
  readonly appId: string;
  /** Per-scope: every corpus finding and whether the pipeline found it. */
  readonly findings: readonly FindingMatch[];
  /** Confirmed exploits that matched no corpus finding. */
  readonly falsePositives: readonly ExploitView[];
  /** Static-scanner rows that matched no corpus finding (noise proxy). */
  readonly unmatchedDetections: readonly VulnerabilityView[];
  readonly aggregates: {
    readonly sniper: { truePositive: number; falseNegative: number; falsePositive: number; recall: number; precision: number; f1: number };
    readonly static: { truePositive: number; falseNegative: number; recall: number; precision: number; f1: number };
    readonly futureCount: number;
  };
  readonly perCwe: ReadonlyArray<{
    readonly cweId: string;
    readonly scope: FindingSpec['scope'];
    readonly truePositive: number;
    readonly falseNegative: number;
    readonly falsePositive: number;
    readonly f1: number;
  }>;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function parseCweKey(key: string): { scope: FindingSpec['scope']; cweId: string } {
  const sep = key.indexOf(':');
  return { scope: key.slice(0, sep) as FindingSpec['scope'], cweId: key.slice(sep + 1) };
}

function aggregateFor(
  matches: readonly FindingMatch[],
  scope: FindingSpec['scope'],
  falsePositives: number
): { truePositive: number; falseNegative: number; falsePositive: number; recall: number; precision: number; f1: number } {
  const scoped = matches.filter((m) => m.scope === scope);
  const truePositive = scoped.filter((m) => m.matchedBy !== null).length;
  const falseNegative = scoped.length - truePositive;
  const falsePositive = falsePositives;
  const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
  const precisionDenom = truePositive + falsePositives;
  const precision = precisionDenom === 0 ? 0 : truePositive / precisionDenom;
  const f1 = recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
  return { truePositive, falseNegative, falsePositive, recall: round(recall), precision: round(precision), f1: round(f1) };
}

/** The main entry point: score one scan's outputs against one corpus app. */
export function buildDetectionReport(
  app: CorpusApp,
  exploits: readonly ExploitView[],
  vulnerabilities: readonly VulnerabilityView[]
): DetectionReport {
  const confirmed = exploits.filter((e) => e.status === 'CONFIRMED' || e.status === 'EXPLOITABLE');
  // Greedy assignment: each exploit can prove at most ONE corpus finding, so
  // one confirmed exploit never double-satisfies duplicate corpus entries.
  const usedExploitIds = new Set<string>();
  const findings: FindingMatch[] = app.groundTruth.map((finding) => {
    if (finding.scope === 'sniper') {
      const match = confirmed.find((e) => {
        if (usedExploitIds.has(e.id)) return false;
        return findingMatchesExploit(finding, e);
      });
      if (match) usedExploitIds.add(match.id);
      return { finding, matchedBy: match ?? null, scope: finding.scope };
    }
    if (finding.scope === 'static') {
      const match = vulnerabilities.find((v) => findingMatchesVulnerability(finding, v));
      return { finding, matchedBy: match ?? null, scope: finding.scope };
    }
    return { finding, matchedBy: null, scope: finding.scope };
  });

  const matchedExploitIds = new Set(
    findings
      .map((m) => m.matchedBy)
      .filter((m): m is ExploitView => m !== null && 'endpoint' in m)
      .map((e) => e.id)
  );
  const falsePositives = confirmed.filter((e) => !matchedExploitIds.has(e.id));

  const matchedVulnIds = new Set(
    findings
      .map((m) => m.matchedBy)
      .filter((m): m is VulnerabilityView => m !== null && !('endpoint' in m))
      .map((v) => v.id)
  );
  const unmatchedDetections = vulnerabilities.filter((v) => !matchedVulnIds.has(v.id));

  const sniper = aggregateFor(findings, 'sniper', falsePositives.length);
  const staticAgg = aggregateFor(findings, 'static', unmatchedDetections.length);

  // Per-CWE (sniper + static only; future excluded from scoring).
  const cweGroups = new Map<string, { scope: FindingSpec['scope']; tp: number; fn: number }>();
  for (const m of findings) {
    if (m.scope === 'future') continue;
    const key = `${m.scope}:${m.finding.cweId}`;
    const g = cweGroups.get(key) ?? { scope: m.scope, tp: 0, fn: 0 };
    if (m.matchedBy !== null) g.tp += 1;
    else g.fn += 1;
    cweGroups.set(key, g);
  }
  const perCwe = [...cweGroups.entries()].map(([key, g]) => {
    const { scope, cweId } = parseCweKey(key);
    const fp = scope === 'sniper' ? falsePositives.filter((e) => e.cweId !== null && e.cweId.toUpperCase() === cweId.toUpperCase()).length : 0;
    const denom = g.tp + fp;
    const precision = denom === 0 ? 0 : g.tp / denom;
    const recallDenom = g.tp + g.fn;
    const recall = recallDenom === 0 ? 0 : g.tp / recallDenom;
    const f1 = recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
    return { cweId, scope, truePositive: g.tp, falseNegative: g.fn, falsePositive: fp, f1: round(f1) };
  });

  return {
    appId: app.id,
    findings,
    falsePositives,
    unmatchedDetections,
    aggregates: {
      sniper,
      static: staticAgg,
      futureCount: findings.filter((m) => m.scope === 'future').length,
    },
    perCwe,
  };
}

/** Recon completeness: fraction of the expected surface actually discovered. */
export function buildReconReport(
  app: CorpusApp,
  surfaces: readonly SurfaceView[]
): { expected: number; discovered: number; recall: number; missing: readonly string[] } {
  const expected = app.expectedSurface ?? [];
  const discoveredKeys = new Set(surfaces.map((s) => `${s.method.toUpperCase()} ${normalizeRoutePath(s.url)}`));
  const missing = expected.filter((e) => {
    const parts = e.split(' ');
    const method = parts.length === 2 ? parts[0]!.toUpperCase() : 'GET';
    const path = parts.length === 2 ? parts[1]! : e;
    return !discoveredKeys.has(`${method} ${normalizeRoutePath(path)}`);
  });
  const recall = expected.length === 0 ? 0 : (expected.length - missing.length) / expected.length;
  return { expected: expected.length, discovered: discoveredKeys.size, recall: round(recall), missing };
}
