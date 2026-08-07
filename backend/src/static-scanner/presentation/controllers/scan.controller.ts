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
    const parsed = ScanStaticRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request body', parsed.error.flatten().fieldErrors);
    }
    const body: ScanStaticRequest = parsed.data;
    const result = await this.scanService.runStaticScan(body.url);
    res.status(201).json(createSuccessResponse(result));
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