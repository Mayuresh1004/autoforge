/**
 * Critic routes — composition root (hidden per Phase 8 spec: the Critic API
 * is a side-channel, NOT mounted in `routes/index.ts`). The infrastructure
 * comes from the app-wide composition root (`application/application`), so
 * the Critic shares the SandboxManager, runtime service and Sniper with the
 * rest of the pipeline. Tests import controller/dto directly; runtime
 * consumers drive the Critic through the remediation loop (application
 * layer), never through a public endpoint.
 *
 *   POST  /api/critic/run
 *   GET   /api/critic/:executionId
 */

import { Router } from 'express';
import { applicationInfrastructure } from '../../../application/application';
import { CriticController } from '../controllers/critic.controller';

const infrastructure = applicationInfrastructure.critic;

const controller = new CriticController(infrastructure.critic);

const router = Router();

router.post('/critic/run', controller.run);
router.get('/critic/:executionId', controller.getRun);

export { router as criticRoutes };
export { infrastructure as criticInfrastructure };