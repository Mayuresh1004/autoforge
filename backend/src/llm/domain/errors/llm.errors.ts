/**
 * LLM provider error taxonomy. Every error carries a stable `code` and a
 * `provider` id so callers and the fallback coordinator can react without
 * string matching.
 *
 * Fallback policy (enforced by the fallback coordinator):
 *   - Eligible:  RATE_LIMIT, UNAVAILABLE (outage/server), MODEL_UNAVAILABLE,
 *                 TIMEOUT — transient conditions that may not repeat on
 *                 another provider.
 *   - Not:       AUTH (invalid key), CONFIG, MALFORMED_REQUEST, POLICY,
 *                 RESPONSE (garbled provider payload / app bug) — these either
 *                 cannot succeed elsewhere or repeating them would mask bugs.
 */

export type LLMErrorCode =
  | 'CONFIG'
  | 'AUTH'
  | 'MALFORMED_REQUEST'
  | 'POLICY'
  | 'RATE_LIMIT'
  | 'MODEL_UNAVAILABLE'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'RESPONSE';

/** Codes for which attempting the next fallback provider is safe. */
const FALLBACK_ELIGIBLE: ReadonlySet<LLMErrorCode> = new Set<LLMErrorCode>([
  'RATE_LIMIT',
  'UNAVAILABLE',
  'MODEL_UNAVAILABLE',
  'TIMEOUT',
]);

export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly provider: string;
  constructor(code: LLMErrorCode, provider: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'LLMError';
    this.code = code;
    this.provider = provider;
  }
}

/** Malformed/unsupported configuration — always an operator bug, never
 *  masked by fallback. */
export class LLMConfigError extends LLMError {
  constructor(message: string, provider = 'config') {
    super('CONFIG', provider, message);
    this.name = 'LLMConfigError';
  }
}

/** Invalid/missing API key. Never retried, never falls back: the key is
 *  wrong for every provider. */
export class LLMAuthenticationError extends LLMError {
  constructor(provider: string, detail: string, cause?: unknown) {
    super('AUTH', provider, `provider authentication failed (${detail})`, cause);
    this.name = 'LLMAuthenticationError';
  }
}

/** The request itself is invalid (bad params, context too long, …). Would
 *  repeat on every provider — no fallback, no retry. */
export class LLMMalformedRequestError extends LLMError {
  constructor(provider: string, detail: string, cause?: unknown) {
    super('MALFORMED_REQUEST', provider, `malformed LLM request (${detail})`, cause);
    this.name = 'LLMMalformedRequestError';
  }
}

/** Content-safety/policy rejection — would recur across providers. */
export class LLMPolicyError extends LLMError {
  constructor(provider: string, detail: string, cause?: unknown) {
    super('POLICY', provider, `provider rejected prompt policy (${detail})`, cause);
    this.name = 'LLMPolicyError';
  }
}

/** Rate limiting / quota. Transient; retry then fallback. */
export class LLMRateLimitError extends LLMError {
  readonly retryAfterSeconds?: number;
  constructor(provider: string, detail: string, retryAfterSeconds?: number, cause?: unknown) {
    super('RATE_LIMIT', provider, `provider rate-limited (${detail})`, cause);
    this.name = 'LLMRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The configured model is not served (anymore). Fallback is safe — a free
 *  model may have been rotated. */
export class LLMModelUnavailableError extends LLMError {
  readonly model: string;
  constructor(provider: string, model: string, detail: string, cause?: unknown) {
    super(
      'MODEL_UNAVAILABLE',
      provider,
      `${model} is unavailable on ${provider} (${detail})`,
      cause,
    );
    this.name = 'LLMModelUnavailableError';
    this.model = model;
  }
}

/** Temporary outage (5xx / network). Retry, then fallback. */
export class LLMUnavailableError extends LLMError {
  constructor(provider: string, detail: string, cause?: unknown) {
    super('UNAVAILABLE', provider, `provider unavailable (${detail})`, cause);
    this.name = 'LLMUnavailableError';
  }
}

/** Request exceeded the configured timeout. Fallback is allowed. */
export class LLMTimeoutError extends LLMError {
  readonly timeoutMs: number;
  constructor(provider: string, timeoutMs: number, cause?: unknown) {
    super('TIMEOUT', provider, `provider timed out after ${timeoutMs}ms`, cause);
    this.name = 'LLMTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** Provider returned something the adapter could not parse — likely an app
 *  bug or provider breakage. No fallback (would mask the bug). */
export class LLMResponseError extends LLMError {
  constructor(provider: string, detail: string, cause?: unknown) {
    super('RESPONSE', provider, `unparseable provider response (${detail})`, cause);
    this.name = 'LLMResponseError';
  }
}

/** True when the coordinator may try the next configured fallback provider. */
export function isFallbackEligible(error: unknown): boolean {
  return error instanceof LLMError && FALLBACK_ELIGIBLE.has(error.code);
}