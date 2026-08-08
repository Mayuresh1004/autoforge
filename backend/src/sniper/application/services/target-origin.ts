import { CrossOriginTargetError, InvalidBaseUrlError } from '../../domain/errors/sniper.errors';

/**
 * Same-origin validation for verification targets. The Sniper must never
 * attack anything outside the sandboxed application: every endpoint is
 * resolved against the provided sandbox base URL and must share its origin
 * (protocol + host + port).
 */

export interface ResolvedTargetEndpoint {
  /** Absolute URL to probe (same-origin with the base). */
  readonly url: string;
  /** The base's origin as an exact-match string. */
  readonly origin: string;
}

/** Parse + validate the sandbox application base URL. */
export function parseBaseUrl(baseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new InvalidBaseUrlError(baseUrl);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidBaseUrlError(baseUrl);
  }
  if (parsed.username || parsed.password) {
    throw new InvalidBaseUrlError(baseUrl);
  }
  return parsed;
}

/**
 * Resolve a planned target's endpoint against the sandbox base URL and
 * require same-origin. Ends with a cross-origin target throw or a usable
 * absolute URL. Relative paths and absolute URLs (same origin) both resolve.
 */
export function resolveSameOriginEndpoint(endpoint: string, baseUrl: string): ResolvedTargetEndpoint {
  const base = parseBaseUrl(baseUrl);
  const resolved = new URL(endpoint, base);
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    throw new InvalidBaseUrlError(resolved.toString());
  }
  if (resolved.origin !== base.origin) {
    throw new CrossOriginTargetError(endpoint, base.origin);
  }
  return { url: resolved.toString(), origin: base.origin };
}