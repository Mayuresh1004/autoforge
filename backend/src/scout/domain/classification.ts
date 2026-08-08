/**
 * Pure path/response classifiers used across the Scout pipeline to derive
 * heuristic signals (isAdmin, isUpload, …). Heuristics only — they steer risk
 * *prioritization* and the report summary, never exploitability.
 */

const ADMIN_RE = /(^|\/)(admin|administrator|wp-admin|console|controlpanel)(\/|$)/i;
const UPLOAD_RE = /(^|\/)(upload|uploads|file-upload|attachment)(\/|$)/i;
const LOGIN_RE = /(^|\/)(login|signin|sign-in|auth|sso)(\/|$)/i;
const API_RE = /^\/(api|v[0-9]|rest|graphql|rpc)(\/|$)/i;
const DOCS_RE = /(openapi|swagger|api-docs|redoc|\/docs)/i;
const HEALTH_RE = /(health|healthz|status|ready|ping)$/i;
const STATIC_EXT_RE =
  /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|map|pdf|zip|gz|mp[34]|webm)$/i;
const PASSWORD_FIELD_RE = /<input[^>]*type=["']password["']/i;
const MULTIPART_RE = /enctype\s*=\s*["']multipart\/form-data["']/i;

/** Heuristic signals that drive risk prioritization. */
export interface EndpointSignals {
  readonly authentication: boolean;
  readonly isAdmin: boolean;
  readonly isUpload: boolean;
  readonly isLogin: boolean;
  readonly isApi: boolean;
  readonly isDocs: boolean;
  readonly isHealth: boolean;
  readonly isStaticAsset: boolean;
  readonly method: string;
  readonly hasParameters: boolean;
  readonly statusCode: number | null;
}

/**
 * Derive heuristic signals for a URL + observed HTTP status. Optional `html`
 * hints (a password input, a `multipart/form-data` form) sharpen the result.
 */
export function classifyEndpoint(
  url: string,
  method: string,
  statusCode: number | null,
  html?: string,
  parameterCount = 0,
): EndpointSignals {
  const path = normalizePath(url);
  const pageHtml = html ?? '';
  const isUpload = UPLOAD_RE.test(path) || MULTIPART_RE.test(pageHtml);
  const isLogin = LOGIN_RE.test(path) || PASSWORD_FIELD_RE.test(pageHtml);
  const authentication = statusCode === 401 || statusCode === 403 || isLogin;

  return {
    authentication,
    isAdmin: ADMIN_RE.test(path),
    isUpload,
    isLogin,
    isApi: API_RE.test(path),
    isDocs: DOCS_RE.test(path),
    isHealth: HEALTH_RE.test(path),
    isStaticAsset: STATIC_EXT_RE.test(path),
    method: method.toUpperCase(),
    hasParameters: path.includes('?') || parameterCount > 0,
    statusCode,
  };
}

/** Strip origin and hash so classification only sees path + query. */
export function normalizePath(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, 'http://localhost');
    return `${url.pathname}${url.search}`;
  } catch {
    return rawUrl;
  }
}