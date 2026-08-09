import { Router } from 'express';
import { applicationInfrastructure } from '../../../application/application';
import { createScoutService } from '../../infrastructure/factory/scout-factory';
import { ScoutController } from '../controllers/scout.controller';

/**
 * Composition root for the Scout Agent. The controller talks to a full
 * recon service backed by the Prisma repository + headless tool runtime
 * (swap in a sandbox-bound runtime via the factory when a runtime sandbox
 * exists for the target app).
 */
const service = createScoutService({ events: applicationInfrastructure.events.publisher });
const controller = new ScoutController(service);

const router = Router();

router.post('/scout/run', controller.run);
router.get('/scout/:scoutScanId', controller.getScoutRun);
router.get('/scout/:scoutScanId/endpoints', controller.getEndpoints);
router.get('/scout/:scoutScanId/ports', controller.getPorts);
router.get('/scout/:scoutScanId/services', controller.getServices);

export { router as scoutRoutes };