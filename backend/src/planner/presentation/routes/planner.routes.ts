import { Router } from 'express';
import { createPlannerService } from '../../infrastructure/factory/plan-factory';
import { PrismaPlanRepository } from '../../infrastructure/repository/prisma-plan-repository';
import { PlannerController } from '../controller/planner.controller';

/**
 * Composition root for the Attack Planner. The controller talks to a reasoning
 * service backed by the Prisma repository (all inputs read-only). The planner
 * never attacks, scans, exploits or patches — it only ranks.
 */
const service = createPlannerService(new PrismaPlanRepository());
const controller = new PlannerController(service);

const router = Router();

router.post('/planner/run', controller.run);
router.get('/planner/plans/:planId/targets', controller.getPlanTargets);
router.get('/planner/plans/:planId', controller.getPlan);
router.get('/planner/scans/:scanId', controller.getPlanForScan);

export { router as plannerRoutes };