import type { PlannerRisk, ScoreFactor } from '../../domain/models/plan';
import type { TargetFeatures, StaticSummary } from './feature-extractor';

export interface ScoredTarget {
  readonly priority: number;
  readonly estimatedRisk: PlannerRisk;
  readonly candidateVulnerabilities: readonly string[];
  readonly recommendedTool: string;
  readonly reason: string;
  readonly breakdown: readonly ScoreFactor[];
}

/** Deterministic, explainable weights (0–100 after clamping). */
const W = {
  scoutCritical: 40,
  scoutHigh: 30,
  scoutMedium: 18,
  scoutLow: 8,
  upload: 14,
  admin: 12,
  api: 8,
  login: 6,
  auth: 4,
  queryParam: 15,
  hasParam: 10,
  dbRelated: 10,
  staticCritical: 18,
  staticHigh: 12,
  staticMedium: 6,
  staticLow: 2,
  categoryMatch: 12,
} as const;

const RISK_RANK: Record<PlannerRisk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/**
 * Scores one attack-surface target into a preliminary priority (0–100) plus
 * candidate vulnerability hypotheses. Every contributing factor is recorded
 * in `breakdown` and summarized in `reason` — no black-box decisions.
 */
export class TargetScorer {
  score(features: TargetFeatures, staticSummary: StaticSummary): ScoredTarget {
    const factors: ScoreFactor[] = [];
    const add = (label: string, points: number, include = true) => {
      if (include && points > 0) factors.push({ label, points });
    };

    // 1. Base: Scout heuristic risk.
    switch (features.scoutRisk) {
      case 'CRITICAL':
        add('scout-risk CRITICAL', W.scoutCritical);
        break;
      case 'HIGH':
        add('scout-risk HIGH', W.scoutHigh);
        break;
      case 'MEDIUM':
        add('scout-risk MEDIUM', W.scoutMedium);
        break;
      default:
        add('scout-risk LOW', W.scoutLow);
    }

    // 2. Endpoint nature.
    add('upload endpoint', W.upload, features.isUpload);
    add('admin panel', W.admin, features.isAdmin);
    add('api endpoint', W.api, features.isApi);
    add('login/auth page', W.login, features.isLogin);
    add('requires authentication', W.auth, features.authentication);
    add('user-input query parameter', W.queryParam, features.hasQuery);
    add('user-supplied parameters', W.hasParam, features.hasParameters && !features.hasQuery);
    add('db-interacting surface', W.dbRelated, features.isDbRelated);

    // 3. Static findings.
    const sev = staticSummary.maxSeverity;
    if (sev === 'CRITICAL') add('CRITICAL static finding', W.staticCritical);
    else if (sev === 'HIGH') add('HIGH static finding', W.staticHigh);
    else if (sev === 'MEDIUM') add('MEDIUM static finding', W.staticMedium);
    else if (sev === 'LOW') add('LOW static finding', W.staticLow);

    // 4. Category overlap: static hypothesis ↔ this endpoint's shape.
    const candidates = this.candidates(features, staticSummary);
    const staticHit = candidates.some((c) => staticSummary.categories.includes(c));
    add(`static findings match hypothesis (${candidates.slice(0, 2).join(', ')})`, W.categoryMatch, staticHit);

    // 5. Tech/framework hint.
    add(
      `framework ${features.profileHint.framework ?? 'unknown'}`,
      3,
      (features.profileHint.framework ?? '').length > 0,
    );

    const total = factors.reduce((sum, f) => sum + f.points, 0);
    const priority = Math.max(5, Math.min(100, Math.round(total)));
    const estimatedRisk = this.risk(priority, features);
    const recommendedTool = toolFor(candidates);

    return {
      priority,
      estimatedRisk,
      candidateVulnerabilities: candidates,
      recommendedTool,
      breakdown: factors.sort((a, b) => b.points - a.points),
      reason: this.reason(features.url, features, factors, candidates, priority),
    };
  }

  /** Hypothesis list: which vuln classes deserve a closer look here. */
  candidates(features: TargetFeatures, summary: StaticSummary): readonly string[] {
    const out: string[] = [];
    const inputDriven = features.hasParameters || features.hasQuery;

    // 1. Static scanner findings correlation
    for (const cat of summary.categories) {
      if (cat === 'SQL Injection' && (inputDriven || features.isDbRelated || features.isApi)) {
        out.push('SQL Injection');
      }
      if (cat === 'Cross-Site Scripting' && (inputDriven || features.isSearch || features.isApi)) {
        out.push('Cross-Site Scripting');
      }
      if (cat === 'Insecure File Upload' && (features.isUpload || features.isApi)) {
        out.push('Insecure File Upload');
      }
      if (cat === 'Server-Side Request Forgery' && (inputDriven || features.isApi)) {
        out.push('Server-Side Request Forgery');
      }
      if ((cat === 'Authentication Bypass' || cat === 'Broken Access Control') && (features.authentication || features.isLogin || features.isApi)) {
        out.push('Broken Access Control');
      }
    }

    // 2. Surface heuristic indicators
    if (features.isUpload) {
      out.push('Insecure File Upload');
    }
    if (features.isDbRelated && inputDriven) {
      out.push('SQL Injection');
    }
    if (features.isSearch || (features.hasQuery && features.isApi)) {
      out.push('Cross-Site Scripting');
    }
    if (features.authentication && (features.hasParameters || features.url.includes(':') || features.url.includes('{'))) {
      out.push('Broken Access Control');
    }
    if (features.hasQuery && /url|target|redirect|fetch/i.test(features.url)) {
      out.push('Server-Side Request Forgery');
    }

    return [...new Set(out)].slice(0, 4);
  }

  private risk(priority: number, features: TargetFeatures): PlannerRisk {
    if (features.isUpload && features.authentication) return 'CRITICAL';
    if (priority >= 80) return 'CRITICAL';
    if (priority >= 60) return 'HIGH';
    if (priority >= 40) return 'MEDIUM';
    return 'LOW';
  }

  private reason(
    url: string,
    features: TargetFeatures,
    factors: readonly ScoreFactor[],
    candidates: readonly string[],
    priority: number,
  ): string {
    const top = factors.slice(0, 3).map((f) => `${f.label} (+${f.points})`);
    const shape = [
      features.authentication ? 'auth-required' : 'public',
      features.hasParameters || features.hasQuery ? 'user-input' : null,
      features.isApi ? 'api' : null,
      features.isUpload ? 'upload' : null,
      features.isAdmin ? 'admin' : null,
    ]
      .filter(Boolean)
      .join(' ');
    const hypothesis = candidates.length > 0 ? `hypothesis: ${candidates.join(', ')}` : 'no strong hypothesis';
    return `${url} — ${shape || features.method} endpoint; ${top.join('; ') || 'baseline'}; priority ${priority}/100; ${hypothesis}.`;
  }
}

/** Suggested executor tool for the top hypothesis (metadata only — Planner runs nothing). */
export function toolFor(candidates: readonly string[]): string {
  if (candidates.includes('SQL Injection')) return 'sqlmap';
  if (candidates.includes('Injection (generic)')) return 'sqlmap';
  if (candidates.includes('Cross-Site Scripting')) return 'nuclei';
  if (candidates.includes('Insecure File Upload')) return 'ffuf';
  if (candidates.includes('Server-Side Request Forgery')) return 'nuclei';
  return 'none';
}

/** Sort order: priority desc, then risk, then endpoint asc (stable). */
export function compareTargets(
  a: { readonly priority: number; readonly estimatedRisk: PlannerRisk; readonly endpoint: string },
  b: { readonly priority: number; readonly estimatedRisk: PlannerRisk; readonly endpoint: string },
): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const diff = RISK_RANK[b.estimatedRisk] - RISK_RANK[a.estimatedRisk];
  if (diff !== 0) return diff;
  return a.endpoint.localeCompare(b.endpoint);
}