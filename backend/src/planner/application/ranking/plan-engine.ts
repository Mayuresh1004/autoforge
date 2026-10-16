import { randomUUID } from 'node:crypto';
import type {
  AttackPlan,
  AttackPlanSummary,
  PlannedTarget,
  TargetVerificationHints,
  ParameterLocation,
} from '../../domain/models/plan';
import type {
  PlanRequest,
  SurfaceInput,
  StaticVulnInput,
} from '../../domain/models/plan-input';
import {
  categorizeFinding,
  extractFeatures,
  summarizeFindings,
} from '../scoring/feature-extractor';
import { TargetScorer, compareTargets } from '../scoring/target-scorer';
import { isExternalDocUrl } from '../../infrastructure/repository/prisma-plan-repository';

/**
 * Rank Engine: turns the plan request into a persisted-ready AttackPlan.
 * Sorts targets by priority, computes the summary, and assigns each target
 * a unique ID and transparent score breakdown.
 */
export class PlanEngine {
  constructor(
    private readonly scorer: TargetScorer = new TargetScorer(),
  ) {}

  build(planId: string, request: PlanRequest): AttackPlan {
    const staticSummary = summarizeFindings(request.staticFindings);

    const validSurfaces = request.attackSurface.filter(
      (surface) => !isExternalDocUrl(surface.url),
    );

    const rawTargets: PlannedTarget[] = validSurfaces.map((surface) => {
      const features = extractFeatures(surface, request.profile);
      const scored = this.scorer.score(features, staticSummary);
      const targetId = randomUUID();

      const matchingFinding = request.staticFindings.find((finding) => {
        if (finding.filePath) {
          const normFile = finding.filePath
            .toLowerCase()
            .replace(/\\/g, '/');

          let normPath = surface.url.toLowerCase();

          try {
            const normalizedUrl = surface.url.startsWith('http')
              ? surface.url
              : `http://localhost${surface.url.startsWith('/') ? '' : '/'}${surface.url}`;

            normPath = new URL(normalizedUrl).pathname.toLowerCase();
          } catch {
            // Keep the original surface URL if it cannot be parsed.
          }

          const pathMatch =
            normPath.includes(normFile) || normFile.includes(normPath);

          if (!pathMatch) {
            return false;
          }
        }

        const categories = categorizeFinding(finding);

        return scored.candidateVulnerabilities.some(
          (candidate) =>
            categories.includes(candidate) ||
            candidate
              .toLowerCase()
              .includes((finding.type || '').toLowerCase()) ||
            Boolean(finding.cwe && candidate.includes(finding.cwe)),
        );
      });

      const verificationHints = deriveVerificationHints(
        surface,
        scored.candidateVulnerabilities,
        matchingFinding,
      );

      return {
        targetId,
        vulnerabilityId:
          matchingFinding?.vulnerabilityId ?? matchingFinding?.id,
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

    // Keep targets grounded in discovered attack surfaces or static findings.
    const targets = rawTargets.filter((target, index) => {
      const surface = validSurfaces[index];
      const features = extractFeatures(surface, request.profile);

      if (
        features.isStatic &&
        !features.hasParameters &&
        !target.vulnerabilityId
      ) {
        return false;
      }

      return (
        target.candidateVulnerabilities.length > 0 ||
        Boolean(target.vulnerabilityId)
      );
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

export function summarizeTargets(
  targets: readonly PlannedTarget[],
): AttackPlanSummary {
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const target of targets) {
    if (target.estimatedRisk === 'CRITICAL') {
      critical += 1;
    } else if (target.estimatedRisk === 'HIGH') {
      high += 1;
    } else if (target.estimatedRisk === 'MEDIUM') {
      medium += 1;
    } else {
      low += 1;
    }
  }

  return {
    targets: targets.length,
    critical,
    high,
    medium,
    low,
  };
}

/** Generate a fresh plan ID. */
export function newPlanId(): string {
  return `plan_${randomUUID().slice(0, 12)}`;
}

/**
 * Derive verification hints from discovered surface data.
 *
 * Parameter guesses are only used when discovery provides no parameter name
 * and the scorer has already identified candidate vulnerabilities.
 */
export function deriveVerificationHints(
  surface: SurfaceInput,
  candidateVulnerabilities: readonly string[],
  _matchingFinding?: StaticVulnInput,
): TargetVerificationHints {
  let paramName: string | undefined = surface.parameters?.[0];
  let paramLocation: ParameterLocation | undefined;
  let uploadField: string | undefined;
  let resourceIdentifier: string | undefined;

  let pathname = surface.url;

  try {
    const normalizedUrl = surface.url.startsWith('http')
      ? surface.url
      : `http://localhost${surface.url.startsWith('/') ? '' : '/'}${surface.url}`;

    const url = new URL(normalizedUrl);
    pathname = url.pathname;

    const searchKeys = Array.from(url.searchParams.keys());

    if (searchKeys.length > 0) {
      paramName = paramName ?? searchKeys[0];
      paramLocation = 'query';
    }
  } catch {
    // Ignore invalid URL formatting.
  }

  // Match common route parameter formats: /users/:id and /users/{id}.
  const pathMatch = pathname.match(/\/(?::([a-zA-Z0-9_]+)|\{([a-zA-Z0-9_]+)\})(?=\/|$)/);

  if (pathMatch) {
    resourceIdentifier = pathMatch[1] ?? pathMatch[2];

    if (!paramName) {
      paramName = resourceIdentifier;
      paramLocation = 'path';
    }
  }

  const isFileUpload = candidateVulnerabilities.some((candidate) =>
    /file|upload|cwe-434/i.test(candidate),
  );

  if (isFileUpload || surface.url.toLowerCase().includes('upload')) {
    uploadField = surface.parameters?.[0] ?? 'file';
  }

  if (!paramLocation) {
    const method = surface.method.toUpperCase();

    paramLocation =
      method === 'POST' || method === 'PUT' || method === 'PATCH'
        ? 'body'
        : 'query';
  }

  const commonParameterGuesses = [
    'id',
    'q',
    'search',
    'name',
    'email',
    'username',
  ];

  let guessed = false;

  if (!paramName && candidateVulnerabilities.length > 0) {
    paramName = commonParameterGuesses[0];
    guessed = true;
  }

  return {
    parameterName: paramName,
    parameterLocation: paramLocation,
    uploadField,
    resourceIdentifier,
    parameters:
      surface.parameters && surface.parameters.length > 0
        ? surface.parameters
        : guessed
          ? commonParameterGuesses
          : undefined,
  };
}
