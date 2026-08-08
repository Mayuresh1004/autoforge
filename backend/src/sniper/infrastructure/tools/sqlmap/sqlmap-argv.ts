/**
 * Pure builder for a controlled sqlmap invocation.
 *
 * Constraints:
 * - argv-only (never a shell string), built from typed inputs;
 * - verification-only: NO --dump, --os-shell, --file-read, tamper modules, or
 *   other state-changing sqlmap features (this phase only PROVES existence);
 * - bounded: hard tool timeout, sqlmap-level per-request timeout, zero request
 *   retries, single thread, minimal level/risk;
 * - output goes to a throwaway dir under /tmp (the sandbox tmpfs), so no
 *   sqlmap session pollutes the working tree.
 */

export interface SqlMapRunOptions {
  /** Absolute endpoint URL to test. */
  readonly url: string;
  readonly method: string;
  /** Auth cookie (explicitly provided by the sandbox/test config only). */
  readonly cookie?: string;
  /** Extra auth header (explicitly provided only). */
  readonly authHeader?: string;
  readonly timeoutMs: number;
  readonly level?: number;
  readonly risk?: number;
  readonly retries?: number;
  readonly dbms?: string;
  readonly outputDir?: string;
}

export interface SqlMapArgv {
  readonly argv: readonly string[];
  /** Exact URL sqlmap receives (POST moves params into --data). */
  readonly probeUrl: string;
  /** POST body passed via --data, when applicable. */
  readonly data?: string;
}

/**
 * Build the sqlmap argv for a verification request. The endpoint's query
 * parameters are materialized as sqlmap test targets: GET keeps them in the
 * URL, POST moves them into `--data`.
 */
export function buildSqlMapArgv(options: SqlMapRunRequirements): SqlMapArgv {
  const url = new URL(options.url);
  const isPost = options.method.toUpperCase() === 'POST';

  let probeUrl = `${url.origin}${url.pathname}${isPost ? '' : url.search}`;
  let data: string | undefined;
  if (isPost && url.search) {
    data = url.search.slice(1); // e.g. q=1&type=book — sqlmap tests both
  }

  const timeoutSeconds = Math.max(1, Math.min(30, Math.round(options.timeoutMs / 1000)));

  const argv: readonly string[] = [
    'sqlmap',
    '--url', probeUrl,
    ...(data ? ['--data', data] : []),
    ...(options.cookie ? ['--cookie', options.cookie] : []),
    ...(options.authHeader ? ['--header', options.authHeader] : []),
    '--batch',
    '--disable-coloring',
    '--flush-session',
    // Bound the run: per-request timeout, no retries, single thread.
    '--timeout', String(timeoutSeconds),
    '--retries', String(Math.max(0, Math.min(3, options.retries ?? 0))),
    '--threads', '1',
    '--level', String(Math.max(1, Math.min(5, options.level ?? 1))),
    '--risk', String(Math.max(1, Math.min(3, options.risk ?? 1))),
    ...(options.dbms ? ['--dbms', options.dbms] : []),
    // Throwaway output dir: nothing persists into the repo/workspace.
    '--output-dir', options.outputDir ?? '/tmp/sqlmap',
  ];

  return { argv, probeUrl, data };
}

/** Seed query params from an explicit record (used by tests/adapter). */
export function toQueryString(params: Readonly<Record<string, string>> | undefined): string {
  if (!params) return '';
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

type SqlMapRunRequirements = SqlMapRunOptions;