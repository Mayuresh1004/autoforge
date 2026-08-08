/**
 * Embedding error taxonomy. Stable `code`s let callers react without string
 * matching. All body-derived detail is redacted before it reaches an Error.
 */

export type EmbeddingErrorCode =
  | 'CONFIG'
  | 'AUTH'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'RESPONSE'
  | 'DIMENSION_MISMATCH';

export class EmbeddingError extends Error {
  readonly code: EmbeddingErrorCode;
  readonly provider: string;
  constructor(code: EmbeddingErrorCode, provider: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'EmbeddingError';
    this.code = code;
    this.provider = provider;
  }
}

/** Invalid/missing configuration — an operator bug, never masked. */
export class EmbeddingConfigError extends EmbeddingError {
  constructor(message: string) {
    super('CONFIG', 'config', message);
    this.name = 'EmbeddingConfigError';
  }
}

/** Invalid/missing API key. */
export class EmbeddingAuthenticationError extends EmbeddingError {
  constructor(provider: string, detail: string, cause?: unknown) {
    super('AUTH', provider, `embedding authentication failed (${detail})`, cause);
    this.name = 'EmbeddingAuthenticationError';
  }
}

/** Transient outage / rate limit / network failure (retryable). */
export class EmbeddingUnavailableError extends EmbeddingError {
  constructor(provider: string, detail: string, cause?: unknown) {
    super('UNAVAILABLE', provider, `embedding provider unavailable (${detail})`, cause);
    this.name = 'EmbeddingUnavailableError';
  }
}

export class EmbeddingTimeoutError extends EmbeddingError {
  constructor(provider: string, timeoutMs: number) {
    super('TIMEOUT', provider, `embedding provider timed out after ${timeoutMs}ms`);
    this.name = 'EmbeddingTimeoutError';
  }
}

/** Unparseable payload / missing vector — app or provider bug. */
export class EmbeddingResponseError extends EmbeddingError {
  constructor(provider: string, detail: string, cause?: unknown) {
    super('RESPONSE', provider, `unparseable embedding response (${detail})`, cause);
    this.name = 'EmbeddingResponseError';
  }
}

/** Vector length did not match the configured dimensions. */
export class EmbeddingDimensionError extends EmbeddingError {
  readonly expected: number;
  readonly actual: number;
  constructor(provider: string, expected: number, actual: number) {
    super(
      'DIMENSION_MISMATCH',
      provider,
      `embedding returned ${actual} dims, expected ${expected}`,
    );
    this.name = 'EmbeddingDimensionError';
    this.expected = expected;
    this.actual = actual;
  }
}