import { ApiError, ApiResponse } from '../types/api.types';

export function createSuccessResponse<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
    error: null,
    timestamp: new Date().toISOString(),
  };
}

export function createErrorResponse(
  code: string,
  message: string,
  details?: unknown
): ApiResponse<null> {
  const error: ApiError = { code, message };
  if (details !== undefined) {
    error.details = details;
  }

  return {
    success: false,
    data: null,
    error,
    timestamp: new Date().toISOString(),
  };
}
