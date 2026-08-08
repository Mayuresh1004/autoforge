import type { Request, Response } from 'express';
import { createSuccessResponse } from '../../../utils/response';
import { asyncHandler } from '../../../middlewares/request.middleware';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../utils/errors';
import { SandboxRuntimeUnsupportedError } from '../../domain/errors/sandbox-runtime.errors';
import {
  InvalidRuntimeRepositoryError,
  RuntimeSandboxCapacityError,
  RuntimeSandboxCreationError,
  RuntimeSandboxForbiddenError,
  RuntimeSandboxNotFoundError,
  UnsupportedRuntimeError,
} from '../../domain/errors/runtime-sandbox.errors';
import type { RuntimeSandboxService } from '../../domain/ports/runtime-sandbox-service';
import {
  CreateRuntimeSandboxRequestSchema,
  toRuntimeSandboxResponse,
} from '../dto/runtime-sandbox.dto';

/**
 * HTTP adapter for runtime sandbox lifecycle. Transport only: validates the
 * request, delegates to the service, maps structured domain errors to HTTP.
 * Creation is synchronous and bounded — the caller receives the READY record
 * or a structured 422 failure with the FAILED record attached.
 */
export class RuntimeSandboxController {
  constructor(private readonly service: RuntimeSandboxService) {}

  /** POST /sandboxes/runtime */
  create = asyncHandler(async (req: Request, res: Response) => {
    const parsed = CreateRuntimeSandboxRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid runtime sandbox request',
        parsed.error.flatten().fieldErrors
      );
    }
    const body = parsed.data;
    try {
      const sandbox = await this.service.create({
        scanId: body.scanId,
        repository: body.repository,
        name: body.name,
        hostExpose: body.hostExpose,
        portOverride: body.portOverride,
      });
      res.status(201).json(createSuccessResponse(toRuntimeSandboxResponse(sandbox)));
    } catch (err) {
      throw this.mapError(err);
    }
  });

  /** GET /sandboxes/runtime/:id?scanId=… */
  get = asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const scanId = optionalScanId(req);
    try {
      const sandbox = await this.service.get(id, { scanId });
      res.json(createSuccessResponse(toRuntimeSandboxResponse(sandbox)));
    } catch (err) {
      throw this.mapError(err);
    }
  });

  /** POST /sandboxes/runtime/:id/health?scanId=… */
  health = asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const scanId = optionalScanId(req);
    try {
      const result = await this.service.healthCheck(id, { scanId });
      res.json(
        createSuccessResponse({
          sandboxId: id,
          ...result,
        })
      );
    } catch (err) {
      throw this.mapError(err);
    }
  });

  /** DELETE /sandboxes/runtime/:id?scanId=… — idempotent */
  destroy = asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const scanId = optionalScanId(req);
    try {
      const sandbox = await this.service.destroy(id, { scanId });
      res.json(createSuccessResponse(toRuntimeSandboxResponse(sandbox)));
    } catch (err) {
      throw this.mapError(err);
    }
  });

  // -- mapping ---------------------------------------------------------------

  private mapError(err: unknown): Error {
    if (err instanceof RuntimeSandboxNotFoundError) return new NotFoundError(err.message);
    if (err instanceof RuntimeSandboxForbiddenError) return new ForbiddenError(err.message);
    if (err instanceof RuntimeSandboxCapacityError) {
      const e = new Error(err.message) as Error & { statusCode: number; code: string; details: unknown };
      e.name = 'TooManyRequestsError';
      Object.assign(e, { statusCode: 429, code: 'CAPACITY', details: { active: err.active, max: err.max } });
      return e;
    }
    if (
      err instanceof UnsupportedRuntimeError ||
      err instanceof InvalidRuntimeRepositoryError ||
      err instanceof RuntimeSandboxCreationError ||
      err instanceof SandboxRuntimeUnsupportedError
    ) {
      const e = new Error(err.message) as Error & { statusCode: number; code: string; details?: unknown };
      Object.assign(e, { statusCode: 422, code: err.code });
      if (err instanceof RuntimeSandboxCreationError && err.sandbox) {
        e.details = { stage: err.stage, sandbox: toRuntimeSandboxResponse(err.sandbox) };
      }
      return e;
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

function optionalScanId(req: Request): string | undefined {
  const raw = req.query.scanId;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}