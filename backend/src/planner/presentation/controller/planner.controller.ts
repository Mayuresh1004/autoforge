import type { Request, Response } from 'express';
import { createSuccessResponse } from '../../../utils/response';
import { asyncHandler } from '../../../middlewares/request.middleware';
import { ValidationError, NotFoundError } from '../../../utils/errors';
import type { PlannerService } from '../../domain/ports/planner';
import { ScanNotFoundError, PlanNotFoundError } from '../../domain/errors/planner.errors';
import { RunPlannerSchema, toPlanResponse } from '../dto/planner.dto';

/**
 * HTTP adapter for the Attack Planner. Transport only. The planner *reasons*:
 * it loads static findings + surface + profile and ranks targets. It never
 * attacks, scans, exploits or patches.
 */
export class PlannerController {
  constructor(private readonly service: PlannerService) {}

  /** POST /planner/run */
  run = asyncHandler(async (req: Request, res: Response) => {
    const parsed = RunPlannerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request body', parsed.error.flatten().fieldErrors);
    }
    try {
      const plan = await this.service.generate(parsed.data.scanId);
      res.status(201).json(createSuccessResponse(toPlanResponse(plan as any)));
    } catch (err) {
      if (err instanceof ScanNotFoundError) throw new NotFoundError(err.message);
      throw err;
    }
  });

  /** GET /planner/plans/:planId */
  getPlan = asyncHandler(async (req: Request, res: Response) => {
    const planId = String(req.params.planId);
    try {
      const plan = await this.service.getPlan(planId);
      res.json(createSuccessResponse(toPlanResponse(plan as any)));
    } catch (err) {
      if (err instanceof PlanNotFoundError) throw new NotFoundError(err.message);
      throw err;
    }
  });

  /** GET /planner/plans/:planId/targets */
  getPlanTargets = asyncHandler(async (req: Request, res: Response) => {
    const planId = String(req.params.planId);
    try {
      const plan = await this.service.getPlan(planId);
      res.json(createSuccessResponse(toPlanResponse(plan as any)));
    } catch (err) {
      if (err instanceof PlanNotFoundError) throw new NotFoundError(err.message);
      throw err;
    }
  });

  /** GET /planner/scans/:scanId */
  getPlanForScan = asyncHandler(async (req: Request, res: Response) => {
    const scanId = String(req.params.scanId);
    const plan = await this.service.getPlanForScan(scanId);
    if (plan === null) throw new NotFoundError(`Attack plan for scan '${scanId}'`);
    res.json(createSuccessResponse(toPlanResponse(plan as any)));
  });
}
