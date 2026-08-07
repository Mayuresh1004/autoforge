import { Router } from 'express';
import { HealthController } from '../controllers/health.controller';
import { HealthService } from '../services/health.service';
import { VersionService } from '../services/version.service';

const healthService = new HealthService();
const versionService = new VersionService();
const healthController = new HealthController(healthService, versionService);

const router = Router();

router.get('/', healthController.getRoot);
router.get('/health', healthController.getHealth);
router.get('/version', healthController.getVersion);

export { router as healthRoutes };
