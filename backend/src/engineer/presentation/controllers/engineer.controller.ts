/**
 * Engineer HTTP controller — transport only. Validates input, delegates to
 * the EngineerService, maps typed errors to HTTP:
 *  - ValidationError                     → 400
 *  - ConfirmedFindingNotFoundError       → 404
 *  - UnsupportedVulnerabilityError       → 422
 *  - InvalidEngineerResponseError        → 422 (never a persisted GENERATED patch)
 *  - EngineerSourceError                 → 502 (sandbox/exec unavailable)
 *  - anything else                       → 500 (recorded as FAILED execution)
 */

import type { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewares/request.middleware';
import { ValidationError } from '../../../utils/errors';
import { createSuccessResponse } from '../../../utils/response';
import {
  ConfirmedFindingNotFoundError,
  EngineerError,
  EngineerSourceError,
  InvalidEngineerResponseError,
  UnsupportedVulnerabilityError,
} from '../../domain/errors/engineer.errors';
import type { EngineerService } from '../../application/services/engineer.service';
import { RunEngineerRequestSchema, toEngineerExecutionResponse, toRunEngineerResponse } from '../dto/engineer.dto';

export class EngineerController {
  constructor(private readonly engineer: EngineerService) {}

  /** POST /engineer/run */
  run = asyncHandler(async (req: Request, res: Response) => {
    const parsed = RunEngineerRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid engineer run request', parsed.error.flatten().fieldErrors);
    }
    const result = await this.engineer.run(parsed.data);
    res.status(200).json(createSuccessResponse(toRunEngineerResponse(result)));
  });

  /** GET /engineer/:executionId */
  getRun = asyncHandler(async (req: Request, res: Response) => {
    const executionId = String(req.params.executionId).trim();
    if (executionId.length === 0 || executionId.length > 128) {
      throw new ValidationError('Invalid execution id');
    }
    const detail = await this.engineer.getRun(executionId);
    if (!detail) {
      throw new EngineerError('FINDING_NOT_FOUND', `engineer execution ${executionId} not found`);
    }
    res.json(createSuccessResponse(toEngineerExecutionResponse(detail)));
  });
}

/** Map typed Engineer errors to HTTP status codes (exported for tests). */
export function engineerErrorStatus(error: unknown): number {
  if (error instanceof ConfirmedFindingNotFoundError) return 404;
  if (error instanceof UnsupportedVulnerabilityError) return 422;
  if (error instanceof InvalidEngineerResponseError) return 422;
  if (error instanceof EngineerSourceError) return 502;
  if (error instanceof EngineerError) return 422;
  return 500;
}