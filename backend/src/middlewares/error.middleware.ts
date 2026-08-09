/**
 * Central error mapping — the ONLY place that turns errors into HTTP
 * responses. Controllers stay transport-only: they throw typed domain
 * errors (or AppError subclasses) and THIS middleware decides the status,
 * code and safe public message.
 *
 * Mapping policy:
 *  - AppError subclasses keep their own statusCode (400/401/403/404/409/503…)
 *  - known agent/domain errors are mapped by class:
 *      Engineer/Critic unsupported vulnerability + invalid responses → 422
 *      patch state conflicts / gate failures            → 422
 *      missing confirmed finding / patch / execution    → 404
 *      sandbox/source infra failure (Engineer)          → 502
 *      sandbox unavailable (Sniper)                     → 503
 *      other Sniper domain errors                       → 400
 *  - anything else                                      → 500 with a SAFE,
 *    generic message. Raw `err.message` is NEVER returned to API clients;
 *    internal detail goes through the existing safe logger only.
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { createErrorResponse } from '../utils/response';
import { logger } from '../config/logger';
import {
  ConfirmedFindingNotFoundError,
  EngineerExecutionNotFoundError,
  EngineerSourceError,
  InvalidEngineerResponseError,
  UnsupportedVulnerabilityError as EngineerUnsupportedVulnerabilityError,
} from '../engineer/domain/errors/engineer.errors';
import {
  InvalidPatchStatusError,
  PatchConflictError,
  PatchNotFoundError,
  SecurityGateFailureError,
  UnsupportedVulnerabilityError as CriticUnsupportedVulnerabilityError,
} from '../critic/domain/errors/critic.errors';
import {
  AuthenticationUnavailableError,
  SandboxUnavailableError,
  SniperError,
  TargetNotFoundError,
} from '../sniper/domain/errors/sniper.errors';
import {
  PlanNotFoundError,
  ScanNotFoundError,
} from '../planner/domain/errors/planner.errors';

/** Public, safe message for unexpected (500) responses. */
export const UNEXPECTED_ERROR_MESSAGE = 'An unexpected error occurred';

/**
 * Resolve an HTTP status for a thrown error. Exported for tests so the
 * whole mapping table is verifiable without an HTTP round-trip.
 */
export function errorStatusForError(err: unknown): number {
  if (err instanceof AppError) return err.statusCode;
  if (err instanceof PatchNotFoundError) return 404;
  if (err instanceof ConfirmedFindingNotFoundError || err instanceof EngineerExecutionNotFoundError) return 404;
  if (err instanceof TargetNotFoundError) return 404;
  if (err instanceof ScanNotFoundError || err instanceof PlanNotFoundError) return 404;
  if (err instanceof EngineerSourceError) return 502;
  if (err instanceof SandboxUnavailableError) return 503;
  if (err instanceof InvalidPatchStatusError) return 422;
  if (err instanceof PatchConflictError) return 422;
  if (err instanceof SecurityGateFailureError) return 422;
  if (err instanceof EngineerUnsupportedVulnerabilityError || err instanceof CriticUnsupportedVulnerabilityError) return 422;
  if (err instanceof InvalidEngineerResponseError) return 422;
  if (err instanceof AuthenticationUnavailableError) return 422;
  if (err instanceof SniperError) return 400;
  return 500;
}

function errorCodeFor(err: unknown, status: number): string {
  if (status >= 500 && !(err instanceof AppError)) return 'INTERNAL_ERROR';
  if (err instanceof AppError) return err.code;
  if (err instanceof Error && typeof (err as unknown as { code?: unknown }).code === 'string') {
    return (err as unknown as { code: string }).code;
  }
  return 'INTERNAL_ERROR';
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status = errorStatusForError(err);
  const code = errorCodeFor(err, status);
  const details = err instanceof AppError ? err.details : undefined;

  if (status >= 500) {
    logger.error({ err }, 'Unhandled error');
  } else if (status >= 400) {
    logger.warn({ err }, 'Request error');
  }

  const message =
    status >= 500 && !(err instanceof AppError) ? UNEXPECTED_ERROR_MESSAGE : err.message ?? UNEXPECTED_ERROR_MESSAGE;
  res.status(status).json(createErrorResponse(code, message, details));
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(
    createErrorResponse('NOT_FOUND', `Route ${req.method} ${req.path} not found`)
  );
}