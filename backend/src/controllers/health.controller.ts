import { HealthService } from '../services/health.service';
import { VersionService } from '../services/version.service';
import { createSuccessResponse } from '../utils/response';
import { asyncHandler } from '../middlewares/request.middleware';

export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly versionService: VersionService
  ) {}

  getRoot = asyncHandler(async (_req, res) => {
    const data = this.versionService.getInfo();
    res.json(createSuccessResponse(data));
  });

  getHealth = asyncHandler(async (_req, res) => {
    const health = await this.healthService.check();
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(createSuccessResponse(health));
  });

  getVersion = asyncHandler(async (_req, res) => {
    const version = this.versionService.getVersion();
    res.json(createSuccessResponse(version));
  });
}
