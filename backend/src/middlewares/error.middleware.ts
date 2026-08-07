import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { createErrorResponse } from '../utils/response';
import { logger } from '../config/logger';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error({ err }, 'Non-operational error');
    }

    res.status(err.statusCode).json(
      createErrorResponse(err.code, err.message, err.details)
    );
    return;
  }

  logger.error({ err }, 'Unhandled error');

  res.status(500).json(
    createErrorResponse(
      'INTERNAL_ERROR',
      process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message
    )
  );
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(
    createErrorResponse('NOT_FOUND', `Route ${req.method} ${req.path} not found`)
  );
}
