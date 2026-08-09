import { z } from 'zod';
import type { PlannedTarget } from '../../domain/models/plan';

/** Body for POST /api/planner/run. */
export const RunPlannerSchema = z.object({
  /** Source static-scan id whose profile/findings/surface feed the plan. */
  scanId: z.string().min(1, 'scanId is required'),
});

export interface PlannerTargetResponse {
  readonly targetId: string;
  readonly endpoint: string;
  readonly method: string;
  readonly candidateVulnerabilities: readonly string[];
  readonly priority: number;
  readonly recommendedTool: string;
  readonly reason: string;
  readonly requiresAuthentication: boolean;
  readonly estimatedRisk: PlannedTarget['estimatedRisk'];
  readonly breakdown: readonly { readonly label: string; readonly points: number }[];
}

export interface PlanResponse {
  readonly planId: string;
  readonly scanId: string;
  readonly status: string;
  readonly targets: readonly PlannerTargetResponse[];
}

export function toPlanResponse(plan: { id?: string; scanId?: string; targets: readonly PlannedTarget[] }): PlanResponse {
  return {
    planId: plan.id ?? '',
    scanId: plan.scanId ?? '',
    status: 'READY',
    targets: plan.targets.map((target) => ({
      targetId: target.targetId,
      endpoint: target.endpoint,
      method: target.method,
      candidateVulnerabilities: target.candidateVulnerabilities,
      priority: target.priority,
      recommendedTool: target.recommendedTool,
      reason: target.reason,
      requiresAuthentication: target.requiresAuthentication,
      estimatedRisk: target.estimatedRisk,
      breakdown: target.breakdown,
    })),
  };
}

export const planParamsSchema = z.object({
  planId: z.string().min(1),
});

export const scanParamsSchema = z.object({
  scanId: z.string().min(1),
});

export type RunPlannerDto = z.infer<typeof RunPlannerSchema>;
export type PlanParamsDto = z.infer<typeof planParamsSchema>;
export type ScanParamsDto = z.infer<typeof scanParamsSchema>;