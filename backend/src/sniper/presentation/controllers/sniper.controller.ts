import type { Request, Response } from 'express';
import { createSuccessResponse } from '../../../utils/response';
import { asyncHandler } from '../../../middlewares/request.middleware';
import { ValidationError, NotFoundError, ServiceUnavailableError } from '../../../utils/errors';
import type { SniperService } from '../../domain/ports/sniper-service';
import { SandboxUnavailableError, SniperError, TargetNotFoundError } from '../../domain/errors/sniper.errors';
import { RunSniperRequestSchema } from '../dto/sniper.dto';

/**
 * HTTP adapter for the Sniper Agent. Transport only — all verification policy
 * lives in the service. Exploit commands only ever run inside the sandbox.
 */
export class SniperController {
  constructor(private readonly service: SniperService) {}

  /** POST /sniper/run — verify planned targets inside the sandbox. */
  run = asyncHandler(async (req: Request, res: Response) => {
    const parsed = RunSniperRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request body', parsed.error.flatten().fieldErrors);
    }
    try {
      const report = await this.service.run(parsed.data);
      res.status(201).json(createSuccessResponse(report));
    } catch (err) {
      throw this.mapError(err as Error);
    }
  });

  /** GET /sniper/:id — final PoC record. */
  get = asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const exploit = await this.service.getExploit(id);
    if (!exploit) throw new NotFoundError(`Exploit with id '${id}'`);
    res.json(createSuccessResponse(exploit));
  });

  /** GET /sniper/:id/results — final PoC + all verification attempts. */
  results = asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const detail = await this.service.getExploitResults(id);
    if (!detail) throw new NotFoundError(`Exploit with id '${id}'`);
    res.json(createSuccessResponse(detail));
  });

  /** GET /sniper/targets/:targetId — every exploit recorded for a target. */
  targetExploits = asyncHandler(async (req: Request, res: Response) => {
    const targetId = String(req.params.targetId);
    const exploits = await this.service.listExploitsForTarget(targetId);
    res.json(createSuccessResponse(exploits));
  });

  /** Translate domain (4xx/5xx) errors into transport errors. */
  private mapError(err: Error): Error {
    if (err instanceof SandboxUnavailableError) return new ServiceUnavailableError(err.message);
    if (err instanceof TargetNotFoundError) return new NotFoundError(err.message);
    if (err instanceof SniperError) return new ValidationError(err.message);
    return err;
  }
}