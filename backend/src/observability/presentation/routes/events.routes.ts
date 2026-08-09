/**
 * SSE event stream route — mounted at GET /api/scans/:scanId/events.
 * Consumes the SINGLE application EventBus from the composition root; the
 * scan-existence gate uses the existing Prisma scan repository (404 before
 * any streaming begins). No bus internals are exposed.
 */

import { Router } from 'express';
import { asyncHandler } from '../../../middlewares/request.middleware';
import { applicationInfrastructure } from '../../../application/application';
import { PrismaScanRepository } from '../../../static-scanner/infrastructure/persistence/prisma/scan-repository.prisma';
import { EventsController } from '../controllers/events.controller';
import { eventsConfig } from '../../../config';

const scanRepository = new PrismaScanRepository();
const controller = new EventsController({
  bus: applicationInfrastructure.events.bus,
  scanExists: async (scanId: string) => (await scanRepository.getScan(scanId)) !== null,
  heartbeatMs: eventsConfig.heartbeatMs,
  sseBufferLines: eventsConfig.sseBufferLines,
});

const router = Router();

router.get('/scans/:scanId/events', asyncHandler(controller.stream));

export { router as scanEventsRoutes };