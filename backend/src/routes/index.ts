import { Router } from 'express';
import { healthRoutes } from './health.routes';

export function createRouter(): Router {
  const router = Router();

  router.use('/', healthRoutes);

  // Future route modules will be mounted here:
  // router.use('/api/scans', scanRoutes);
  // router.use('/api/vulnerabilities', vulnerabilityRoutes);
  // router.use('/api/repositories', repositoryRoutes);

  return router;
}
