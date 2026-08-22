import { randomUUID } from 'node:crypto';
import type { AttackPlan, AttackPlanSummary, PlannedTarget } from '../../domain/models/plan';
import type { PlanRequest, SurfaceInput, StaticVulnInput } from '../../domain/models/plan-input';
import { categorizeFinding, extractFeatures, summarizeFindings } from '../scoring/feature-extractor';
import { TargetScorer, compareTargets } from '../scoring/target-scorer';
import { isExternalDocUrl } from '../../infrastructure/repository/prisma-plan-repository';

/**
 * Rank Engine: turns the plan request into a persisted-ready AttackPlan.
 * Pure reasoning — sorts by priority (highest first), computes the summary,
 * and assigns each target a unique id + transparent score breakdown.
 */
export class PlanEngine {
  constructor(private readonly scorer: TargetScorer = new TargetScorer()) {}

  build(planId: string, request: PlanRequest): AttackPlan {
    const staticSummary = summarizeFindings(request.staticFindings);

    const validSurfaces = request.attackSurface.filter((surface) => !isExternalDocUrl(surface.url));

    const targets: PlannedTarget[] = validSurfaces.map((surface) => {
      const features = extractFeatures(surface, request.profile);
      const scored = this.scorer.score(features, staticSummary);
      const targetId = randomUUID();

      const matchingFinding = request.staticFindings
        .filter((f) => {
          const categories = categorizeFinding(f);
          return scored.candidateVulnerabilities.some((c) => categories.includes(c));
        })
        .sort((a, b) => {
          const aPath = a.filePath ? a.filePath.toLowerCase() : '';
          const bPath = b.filePath ? b.filePath.toLowerCase() : '';
          const urlLower = surface.url.toLowerCase();
          const aMatch = aPath && urlLower.includes(aPath.split('/').pop()?.replace(/\..*$/, '') ?? '___') ? 1 : 0;
          const bMatch = bPath && urlLower.includes(bPath.split('/').pop()?.replace(/\..*$/, '') ?? '___') ? 1 : 0;
          return bMatch - aMatch;
        })[0];

      const verificationHints = deriveVerificationHints(surface, scored.candidateVulnerabilities, matchingFinding);

      return {
        targetId,
        vulnerabilityId: matchingFinding?.vulnerabilityId ?? matchingFinding?.id,
        endpoint: surface.url,
        method: features.method,
        candidateVulnerabilities: scored.candidateVulnerabilities,
        priority: scored.priority,
        recommendedTool: scored.recommendedTool,
        reason: scored.reason,
        requiresAuthentication: features.authentication,
        estimatedRisk: scored.estimatedRisk,
        breakdown: scored.breakdown,
        verificationHints,
      };
    });

    targets.sort(compareTargets);

    return {
      id: planId,
      scanId: request.scanId,
      createdAt: new Date().toISOString(),
      coveredSurfaces: validSurfaces.length,
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

export function deriveVerificationHints(
  surface: SurfaceInput,
  candidateVulnerabilities: readonly string[],
  _matchingFinding?: StaticVulnInput
): import('../../domain/models/plan').TargetVerificationHints {
  let paramName: string | undefined = surface.parameters?.[0];
  let paramLocation: import('../../domain/models/plan').ParameterLocation | undefined = undefined;
  let uploadField: string | undefined = undefined;
  let resourceIdentifier: string | undefined = undefined;

  let pathname = surface.url;
  try {
    const urlObj = new URL(surface.url);
    pathname = urlObj.pathname;
    const searchKeys = Array.from(urlObj.searchParams.keys());
    if (searchKeys.length > 0) {
      paramName = paramName ?? searchKeys[0];
      paramLocation = 'query';
    }
  } catch {
    // Ignore invalid URL formatting
  }

  const pathMatch = pathname.match(/[:{]([a-zA-Z0-9_]+)}?/);
  if (pathMatch) {
    resourceIdentifier = pathMatch[1];
    if (!paramName) {
      paramName = pathMatch[1];
      paramLocation = 'path';
    }
  }

  const isFileUpload = candidateVulnerabilities.some((c) => /file|upload|cwe-434/i.test(c));
  if (isFileUpload || surface.url.toLowerCase().includes('upload')) {
    uploadField = surface.parameters?.[0] ?? 'file';
  }

  if (!paramLocation) {
    const method = surface.method.toUpperCase();
    paramLocation = method === 'POST' || method === 'PUT' ? 'body' : 'query';
  }

  return {
    parameterName: paramName,
    parameterLocation: paramLocation,
    uploadField,
    resourceIdentifier,
    parameters: surface.parameters && surface.parameters.length > 0 ? surface.parameters : undefined,
  };
}