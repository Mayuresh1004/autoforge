import { Router } from 'express';
import { applicationInfrastructure } from '../../../application/application';
import { RuntimeSandboxController } from '../controllers/runtime-sandbox.controller';

/**
 * Composition root for the runtime-sandbox HTTP surface — the app-wide
 * (module-singleton) infrastructure from `application/application`. Agents
 * never touch this router's lifecycle: they consume the READY context via
 * their own services using the SAME SandboxManager. Route order: literal
 * `/runtime/:id/health` is registered before generic `/:id` handlers to
 * avoid shadowing.
 */
const infrastructure = applicationInfrastructure.runtime;
const controller = new RuntimeSandboxController(infrastructure.service);

const router = Router();

router.post('/sandboxes/runtime', controller.create);
router.get('/sandboxes/runtime/:id', controller.get);
router.post('/sandboxes/runtime/:id/health', controller.health);
router.delete('/sandboxes/runtime/:id', controller.destroy);

export { router as runtimeSandboxRoutes };
export { infrastructure as runtimeSandboxInfrastructure };