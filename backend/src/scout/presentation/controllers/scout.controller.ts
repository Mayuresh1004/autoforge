import type { Request, Response } from 'express';
import { createSuccessResponse } from '../../../utils/response';
import { asyncHandler } from '../../../middlewares/request.middleware';
import { ValidationError, NotFoundError } from '../../../utils/errors';
import type { ScoutService } from '../../domain/ports/scout-service';
import { ScoutScanNotFoundError } from '../../domain/errors/scout.errors';
import { RunScoutRequestSchema, type RunScoutRequest } from '../dto/run-scout.dto';

/**
 * HTTP adapter for the Scout Agent. Transport only — the service orchestrates
 * recon. Recon only: nothing here exploits, modifies, or probes beyond an
 * idle crawl / bounded GET/HEAD.
 */
export class ScoutController {
  constructor(private readonly service: ScoutService) {}

  /** POST /scout/run */
  run = asyncHandler(async (req: Request, res: Response) => {
    const parsed = RunScoutRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request body', parsed.error.flatten().fieldErrors);
    }
    const body: RunScoutRequest = parsed.data;
    try {
      const report = await this.service.run({
        scanId: body.scanId,
        targetUrl: body.targetUrl,
        options: body.options,
      });
      res.status(201).json(createSuccessResponse(report));
    } catch (err) {
      if (err instanceof ScoutScanNotFoundError) throw new NotFoundError(err.message);
      throw err;
    }
  });

  /** GET /scout/:scoutScanId */
  getScoutRun = asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.scoutScanId);
    const result = await this.service.getScoutScan(id);
    if (result === null) throw new NotFoundError(`Scout run '${id}'`);
    res.json(createSuccessResponse(result));
  });

  /** GET /scout/:scoutScanId/endpoints */
  getEndpoints = asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.scoutScanId);
    const result = await this.service.getScoutScan(id);
    if (result === null) throw new NotFoundError(`Scout run '${id}'`);
    res.json(createSuccessResponse({ scoutScanId: id, endpoints: result.attackSurface }));
  });

  /** GET /scout/:scoutScanId/ports */
  getPorts = asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.scoutScanId);
    const result = await this.service.getScoutScan(id);
    if (result === null) throw new NotFoundError(`Scout run '${id}'`);
    res.json(createSuccessResponse({ scoutScanId: id, ports: result.ports }));
  });

  /** GET /scout/:scoutScanId/services */
  getServices = asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.scoutScanId);
    const result = await this.service.getScoutScan(id);
    if (result === null) throw new NotFoundError(`Scout run '${id}'`);
    res.json(createSuccessResponse({ scoutScanId: id, services: result.services }));
  });
}