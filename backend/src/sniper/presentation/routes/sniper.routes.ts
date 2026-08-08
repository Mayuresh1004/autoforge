import { Router } from 'express';
import { createSniperInfrastructure } from '../../infrastructure/factory/sniper-factory';
import { SniperController } from '../controllers/sniper.controller';

/**
 * Composition root for the Sniper Agent. The controller wraps the service
 * whose verifiers and sandbox manager are wired by the factory. Note the
 * route order: `/sniper/targets/:targetId` must be registered BEFORE
 * `/sniper/:id` so the literal segment wins.
 */
export function createSniperRouter(): Router {
  const { service } = createSniperInfrastructure();
  const controller = new SniperController(service);

  const router = Router();

  router.post('/sniper/run', controller.run);
  router.get('/sniper/targets/:targetId', controller.targetExploits);
  router.get('/sniper/:id/results', controller.results);
  router.get('/sniper/:id', controller.get);

  return router;
}

export { Router };