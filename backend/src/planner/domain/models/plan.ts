export type PlannerRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Public risk label assigned by the planner (subset of PlannerRisk). */
export type EstimatedRisk = PlannerRisk;

/** A named scoring contribution that explains *why* a target got its score. */
export interface ScoreFactor {
  readonly label: string;
  /** Points added to the base (0–100 total, clamped). */
  readonly points: number;
}

export type ParameterLocation = 'query' | 'path' | 'body' | 'form' | 'header' | 'cookie';

export interface TargetAuthorizationContext {
  readonly ownerCredentialRef?: string;
  readonly attackerCredentialRef?: string;
}

export interface TargetVerificationHints {
  readonly parameterName?: string;
  readonly parameterLocation?: ParameterLocation;
  readonly uploadField?: string;
  readonly contentType?: string;
  readonly resourceIdentifier?: string;
  readonly authorizationContext?: TargetAuthorizationContext;
}

/** One prioritized attack-surface target in the plan. The Planner only
 * *ranks* it — it never executes, and every box is explained by `breakdown`,
 * so there are no black-box decisions. */
export interface PlannedTarget {
  readonly targetId: string;
  readonly vulnerabilityId?: string;
  readonly endpoint: string;
  readonly method: string;
  /** Risk hypotheses to test first (never claims to be conclusive). */
  readonly candidateVulnerabilities: readonly string[];
  /** preliminary priority 0–100, higher first. */
  readonly priority: number;
  /** Tool a future executor might start with (metadata only; Planner runs nothing). */
  readonly recommendedTool: string;
  /** Human-readable, factor-level explanation of the score. */
  readonly reason: string;
  readonly requiresAuthentication: boolean;
  readonly estimatedRisk: EstimatedRisk;
  /** Transparent score accounting: name + points of each contributing factor. */
  readonly breakdown: readonly ScoreFactor[];
  /** Structured hints guiding exploit verifiers (parameter names, upload fields, locations, auth context). */
  readonly verificationHints?: TargetVerificationHints;
}

export interface AttackPlanSummary {
  readonly targets: number;
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
}

export interface AttackPlan {
  readonly id: string;
  readonly scanId: string;
  readonly createdAt: Date | string;
  /** How many raw attack-surface + static signals fed the plan. */
  readonly coveredSurfaces: number;
  readonly coveredFindings: number;
  readonly summary: AttackPlanSummary;
  readonly targets: readonly PlannedTarget[];
}

export const EMPTY_PLAN_SUMMARY: AttackPlanSummary = {
  targets: 0,
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
};