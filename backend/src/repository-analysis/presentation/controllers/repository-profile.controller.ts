import type { Request, Response } from 'express';
import { RepositoryProfileService } from '../../application/services/repository-profile.service';
import { createSuccessResponse } from '../../../utils/response';
import { asyncHandler } from '../../../middlewares/request.middleware';
import { ValidationError } from '../../../utils/errors';
import {
  AnalyzeRepositoryRequestSchema,
  type AnalyzeRepositoryRequest,
} from '../dto/analyze-repository.dto';

/**
 * HTTP adapter for the repository analysis pipeline. Validates the request
 * payload, delegates to the application service, and wraps the resulting
 * RepositoryProfile in the standard success response envelope.
 */
export class RepositoryProfileController {
  constructor(private readonly profileService: RepositoryProfileService) {}

  analyze = asyncHandler(async (req: Request, res: Response) => {
    const parsed = AnalyzeRepositoryRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const body: AnalyzeRepositoryRequest = parsed.data;
    const profile = await this.profileService.analyzeRepository(body.url);

    res.json(createSuccessResponse(profile));
  });
}