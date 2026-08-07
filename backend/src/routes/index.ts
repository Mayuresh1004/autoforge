import { Router } from 'express';
import { healthRoutes } from './health.routes';
import { repositoryProfileRoutes } from '../repository-analysis/presentation/routes/repository-profile.routes';
import { scanRoutes } from '../static-scanner/presentation/routes/scan.routes';

export function createRouter(): Router {
  const router = Router();

  router.use('/', healthRoutes);
  router.use('/api', repositoryProfileRoutes);
  router.use('/api', scanRoutes);

  // Future route modules will be mounted here:
  // router.use('/api/scans', scanRoutes);
  // router.use('/api/vulnerabilities', vulnerabilityRoutes);

  return router;
}
