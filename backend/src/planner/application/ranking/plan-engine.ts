import { randomUUID } from 'node:crypto';
import type { AttackPlan, AttackPlanSummary, PlannedTarget } from '../../domain/models/plan';
import type { PlanRequest } from '../../domain/models/plan-input';
import { extractFeatures, summarizeFindings } from '../scoring/feature-extractor';
import { TargetScorer, compareTargets } from '../scoring/target-scorer';

/**
 * Rank Engine: turns the plan request into a persisted-ready AttackPlan.
 * Pure reasoning — sorts by priority (highest first), computes the summary,
 * and assigns each target a unique id + transparent score breakdown.
 */
export class PlanEngine {
  constructor(private readonly scorer: TargetScorer = new TargetScorer()) {}

  build(planId: string, request: PlanRequest): AttackPlan {
    const staticSummary = summarizeFindings(request.staticFindings);

    const targets: PlannedTarget[] = request.attackSurface.map((surface) => {
      const features = extractFeatures(surface, request.profile);
      const scored = this.scorer.score(features, staticSummary);
      const targetId = randomUUID();
      return {
        targetId,
        endpoint: surface.url,
        method: features.method,
        candidateVulnerabilities: scored.candidateVulnerabilities,
        priority: scored.priority,
        recommendedTool: scored.recommendedTool,
        reason: scored.reason,
        requiresAuthentication: features.authentication,
        estimatedRisk: scored.estimatedRisk,
        breakdown: scored.breakdown,
      };
    });

    targets.sort(compareTargets);

    return {
      id: planId,
      scanId: request.scanId,
      createdAt: new Date().toISOString(),
      coveredSurfaces: request.attackSurface.length,
      coveredFindings: request.staticFindings.length,
      summary: summarizeTargets(targets),
      targets,
    };
  }
}

export function summarizeTargets(targets: readonly PlannedTarget[]): AttackPlanSummary {
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  for (const t of targets) {
    if (t.estimatedRisk === 'CRITICAL') critical += 1;
    else if (t.estimatedRisk === 'HIGH') high += 1;
    else if (t.estimatedRisk === 'MEDIUM') medium += 1;
    else low += 1;
  }
  return { targets: targets.length, critical, high, medium, low };
}

/** Generate a fresh plan id (collision-resistant). */
export function newPlanId(): string {
  return `plan_${randomUUID().slice(0, 12)}`;
}