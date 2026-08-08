import { z } from 'zod';

/** Body for POST /api/planner/run. */
export const RunPlannerSchema = z.object({
  /** Source static-scan id whose profile/findings/surface feed the plan. */
  scanId: z.string().min(1, 'scanId is required'),
});

export const planParamsSchema = z.object({
  planId: z.string().min(1),
});

export const scanParamsSchema = z.object({
  scanId: z.string().min(1),
});

export type RunPlannerDto = z.infer<typeof RunPlannerSchema>;
export type PlanParamsDto = z.infer<typeof planParamsSchema>;
export type ScanParamsDto = z.infer<typeof scanParamsSchema>;