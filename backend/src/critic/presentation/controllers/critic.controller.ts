/**
 * Critic HTTP controller — transport only. Validates input, delegates to
 * the CriticService, maps typed errors to HTTP:
 *   - ValidationError                      → 400
 *   - PatchNotFoundError                   → 404
 *   - InvalidPatchStatusError              → 422 (state transition rejected)
 *   - UnsupportedVulnerabilityError        → 422
 *   - PatchConflictError / gate failures   → 422 (rejected deterministically)
 *   - anything else                        → 500 (recorded as FAILED run)
 *
 * CRITIC only ever accepts GENERATED patches on CONFIRMED SQLI findings;
 * every other combination fails fast before any sandbox is touched.
 */

import type { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewares/request.middleware';
import { ValidationError } from '../../../utils/errors';
import { createSuccessResponse } from '../../../utils/response';
import { PatchNotFoundError } from '../../domain/errors/critic.errors';
import type { CriticService } from '../../application/services/critic.service';
import { RunCriticRequestSchema, toCriticRunResponse } from '../dto/critic.dto';

export class CriticController {
  constructor(private readonly critic: CriticService) {}

  /** POST /api/critic/run — validate ONE patch (attempt 1 by default). */
  run = asyncHandler(async (req: Request, res: Response) => {
    const parsed = RunCriticRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid critic run request', parsed.error.flatten().fieldErrors);
    }
    const result = await this.critic.run(parsed.data);
    res.status(200).json(createSuccessResponse(toCriticRunResponse(result)));
  });

  /** GET /api/critic/:executionId — look up a recorded run. */
  getRun = asyncHandler(async (req: Request, res: Response) => {
    const executionId = String(req.params.executionId).trim();
    if (executionId.length === 0 || executionId.length > 128) {
      throw new ValidationError('Invalid execution id');
    }
    const result = await this.critic.getRun(executionId);
    if (!result) {
      throw new PatchNotFoundError('execution:' + executionId);
    }
    res.json(createSuccessResponse(toCriticRunResponse(result)));
  });
}