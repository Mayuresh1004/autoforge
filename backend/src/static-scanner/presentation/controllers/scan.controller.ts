import { logger } from '../../../config/logger';
import type { Request, Response } from 'express';
import type { StaticScanGateway } from '../../application/ports/static-scan-gateway';
import { createSuccessResponse } from '../../../utils/response';
import { asyncHandler } from '../../../middlewares/request.middleware';
import { ValidationError, NotFoundError } from '../../../utils/errors';
import {
  ScanStaticRequestSchema,
  type ScanStaticRequest,
} from '../dto/scan-static.dto';

/**
 * HTTP adapter for the static scanner. Runs a scan and exposes its results /
 * statistics. No security decisions happen here — the gateway does the work
 * and the controller just transports.
 */
export class ScanController {
  constructor(private readonly scanService: StaticScanGateway) {}

  createStaticScan = asyncHandler(async (req: Request, res: Response) => {
    logger.info({ url: req.body?.url }, 'SCAN_REQUEST_RECEIVED');
    const parsed = ScanStaticRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request body', parsed.error.flatten().fieldErrors);
    }
    const body: ScanStaticRequest = parsed.data;

    let scanId: string;
    let status = 'RUNNING';

    if (typeof this.scanService.startStaticScan === 'function') {
      const started = await this.scanService.startStaticScan(body.url);
      scanId = started.scanId;
      status = started.status ?? 'RUNNING';
    } else {
      const result = await this.scanService.runStaticScan(body.url);
      scanId = result.scanId;
      status = result.status ?? 'COMPLETED';
    }

    logger.info({ scanId, status }, 'SCAN_RESPONSE_SENT');
    res.status(202).json(
      createSuccessResponse({
        scanId,
        status,
      })
    );
  });

  getScan = asyncHandler(async (req: Request, res: Response) => {
    const scanId = String(req.params.id);
    const overview = await this.scanService.getScanOverview(scanId);
    if (overview === null) throw new NotFoundError(`Scan '${scanId}'`);
    res.json(createSuccessResponse(overview));
  });

  getScanResults = asyncHandler(async (req: Request, res: Response) => {
    const scanId = String(req.params.id);
    const findings = await this.scanService.getScanFindings(scanId);
    if (findings === null) throw new NotFoundError(`Scan '${scanId}'`);
    res.json(createSuccessResponse({ scanId, findings }));
  });

  getScanStatistics = asyncHandler(async (req: Request, res: Response) => {
    const scanId = String(req.params.id);
    const statistics = await this.scanService.getScanStatistics(scanId);
    if (statistics === null) throw new NotFoundError(`Scan '${scanId}'`);
    res.json(createSuccessResponse({ scanId, ...statistics }));
  });
}