/**
 * Engineer routes — wired through the app-wide composition root
 * (`application/application`), so the Engineer uses the SAME SandboxManager
 * as the runtime surface, the shared PromptRegistry, the shared (lazy) LLM
 * provider and the shared AgentExecution recorder. Nothing touches the
 * network until a handler runs.
 *
 * POST  /api/engineer/run
 * GET   /api/engineer/:executionId
 */

import { Router } from 'express';
import { applicationInfrastructure } from '../../../application/application';
import { EngineerController } from '../controllers/engineer.controller';

const infrastructure = applicationInfrastructure.engineer;

const controller = new EngineerController(infrastructure.engineer);

const router = Router();

router.post('/engineer/run', controller.run);
router.get('/engineer/:executionId', controller.getRun);

export { router as engineerRoutes };
export { infrastructure as engineerInfrastructure };