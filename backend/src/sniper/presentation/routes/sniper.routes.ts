import { Router } from 'express';
import { applicationInfrastructure } from '../../../application/application';
import { SniperController } from '../controllers/sniper.controller';

/**
 * Composition root for the Sniper Agent — service wired by the app-wide
 * infrastructure with the SINGLE shared SandboxManager (so the Sniper can
 * re-verify sandboxes created through the runtime surface). Note the route
 * order: `/sniper/targets/:targetId` must be registered BEFORE `/sniper/:id`
 * so the literal segment wins.
 */
export function createSniperRouter(): Router {
  const service = applicationInfrastructure.sniper.service;
  const controller = new SniperController(service);

  const router = Router();

  router.post('/sniper/run', controller.run);
  router.get('/sniper/targets/:targetId', controller.targetExploits);
  router.get('/sniper/:id/results', controller.results);
  router.get('/sniper/:id', controller.get);

  return router;
}

export { Router };