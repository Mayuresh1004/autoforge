import { Router } from 'express';
import { healthRoutes } from './health.routes';
import { repositoryProfileRoutes } from '../repository-analysis/presentation/routes/repository-profile.routes';

export function createRouter(): Router {
  const router = Router();

  router.use('/', healthRoutes);
  router.use('/api', repositoryProfileRoutes);

  // Future route modules will be mounted here:
  // router.use('/api/scans', scanRoutes);
  // router.use('/api/vulnerabilities', vulnerabilityRoutes);

  return router;
}
