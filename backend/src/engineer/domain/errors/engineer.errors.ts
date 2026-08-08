/**
 * Engineer agent error taxonomy. Typed errors so the HTTP layer can map
 * failures precisely:
 *  - ConfirmedFindingNotFoundError  → 404
 *  - UnsupportedVulnerabilityError  → 422
 *  - EngineerSourceError            → 502 (sandbox exec problems)
 *  - InvalidEngineerResponseError   → 422 (malformed LLM output — nothing
 *    persists as a GENERATED patch)
 *  - EngineerValidationError        → 422 (structural validation of the run
 *    input, e.g. invalid scanId path traversal)
 */

export type EngineerErrorCode =
  | 'FINDING_NOT_FOUND'
  | 'UNSUPPORTED_VULNERABILITY'
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_TOO_LARGE'
  | 'SOURCE_INVALID_PATH'
  | 'INVALID_RESPONSE'
  | 'REVIEW_GATE_REJECTED'
  | 'PATCH_VALIDATION_FAILED'
  | 'LLM_FAILED'
  | 'VALIDATION';

export class EngineerError extends Error {
  readonly code: EngineerErrorCode;
  readonly details?: unknown;

  constructor(code: EngineerErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'EngineerError';
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class EngineerValidationError extends EngineerError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION', message, details);
    this.name = 'EngineerValidationError';
  }
}

export class ConfirmedFindingNotFoundError extends EngineerError {
  constructor(detail: string) {
    super('FINDING_NOT_FOUND', `no confirmed SQL-injection finding matches: ${detail}`);
    this.name = 'ConfirmedFindingNotFoundError';
  }
}

export class UnsupportedVulnerabilityError extends EngineerError {
  constructor(detail: string) {
    super('UNSUPPORTED_VULNERABILITY', `engineer only remediates CONFIRMED SQL_INJECTION: ${detail}`);
    this.name = 'UnsupportedVulnerabilityError';
  }
}

export class EngineerSourceError extends EngineerError {
  constructor(code: 'SOURCE_UNAVAILABLE' | 'SOURCE_TOO_LARGE' | 'SOURCE_INVALID_PATH', message: string) {
    super(code, message);
    this.name = 'EngineerSourceError';
  }
}

export class InvalidEngineerResponseError extends EngineerError {
  constructor(message: string, details?: unknown) {
    super('INVALID_RESPONSE', message, details);
    this.name = 'InvalidEngineerResponseError';
  }
}