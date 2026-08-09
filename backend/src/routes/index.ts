import { Router } from 'express';
import { healthRoutes } from './health.routes';
import { repositoryProfileRoutes } from '../repository-analysis/presentation/routes/repository-profile.routes';
import { scanRoutes } from '../static-scanner/presentation/routes/scan.routes';
import { scoutRoutes } from '../scout/presentation/routes/scout.routes';
import { plannerRoutes } from '../planner/presentation/routes/planner.routes';
import { createSniperRouter } from '../sniper/presentation/routes/sniper.routes';
import { runtimeSandboxRoutes } from '../sandbox/presentation/routes/runtime-sandbox.routes';
import { knowledgeRoutes } from '../knowledge/presentation/routes/knowledge.routes';
import { engineerRoutes } from '../engineer/presentation/routes/engineer.routes';
import { scanEventsRoutes } from '../observability/presentation/routes/events.routes';

export function createRouter(): Router {
  const router = Router();

  router.use('/', healthRoutes);
  router.use('/api', repositoryProfileRoutes);
  router.use('/api', scanRoutes);
  router.use('/api', scoutRoutes);
  router.use('/api', plannerRoutes);
  router.use('/api', createSniperRouter());
  router.use('/api', runtimeSandboxRoutes);
  router.use('/api', knowledgeRoutes);
  router.use('/api', engineerRoutes);
  router.use('/api', scanEventsRoutes);

  return router;
}