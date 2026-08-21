/**
 * Parser for sqlmap output. Translates raw tool stdout/stderr into
 * structured signals the classifier can reason about deterministically.
 *
 * Detection strategy (safer than exit codes): sqlmap exits 0 even when the
 * target is NOT injectable (it then prints "all tested parameters do not
 * appear to be injectable"), so the verdict must come from the text.
 */

export interface ParsedSqlMapOutput {
  /** sqlmap explicitly identified ≥1 injection point. */
  readonly vulnerable: boolean;
  /** Parameter name (e.g. `query`) for the first confirmed point. */
  readonly parameter: string | null;
  /** HTTP method sqlmap bound the injection to (GET/POST/COOKIE/…). */
  readonly method: string | null;
  /** Confirmed techniques (deduplicated), e.g. ["boolean","error-based"]. */
  readonly techniques: readonly string[];
  /** Distinct payload titles observed (proves multiple attack vectors). */
  readonly payloadCount: number;
  /** Back-end DBMS when sqlmap identified one. */
  readonly dbms: string | null;
  /** sqlmap explicitly ruled out injection for every tested parameter. */
  readonly noInjection: boolean;
  /** A runtime/connection-level problem prevented a verdict. */
  readonly connectionError: boolean;
  /** Target endpoint required authentication or redirected to login. */
  readonly authRequired: boolean;
  /** sqlmap failed before reaching a verdict (crash / abort). */
  readonly toolError: boolean;
  /** Whether sqlmap communicated with the target at all. */
  readonly reached: boolean;
}

const PARAMETER_RE = /Parameter:\s*([^\s(]+)\s*\(([^)]+)\)/i;
const TECHNIQUE_RE = /Type:\s*(.+)/i;
const PAYLOAD_RE = /^\s*Payload:\s*/m;
const DBMS_RE =
  /back-end DBMS[:\s]+[^:\n]*?\b(mysql|postgresql|sqlite|microsoft sql server|oracle|mariadb|db2|access|firebird|sybase|informix)\b/i;
const NO_INJECTION_RE =
  /all tested parameters do not appear to be injectable|do not appear to be injectable/i;
const CONNECTION_RE =
  /connection refused|unable to connect|timed out|connection reset|no connection/i;
const AUTH_REQUIRED_RE =
  /401\s+unauthorized|403\s+forbidden|http error code (?:401|403)|got a (?:301|302|303|307|308) redirect to ['"][^'"]*(?:login|signin|auth|sso)|redirecting to [^\s]*(?:login|signin|auth|sso)|target url content requires authentication|http authentication required|authentication is required/i;
const TOOL_ERROR_RE =
  /\[CRITICAL\]|traceback|panic|segmentation fault|command not found|no such file/i;
const VULNERABLE_RE = /sqlmap identified the following injection point\(s\)/i;

export function parseSqlMapOutput(stdout: string, stderr: string): ParsedSqlMapOutput {
  const combined = `${stderr}\n${stdout}`;

  const vulnerable = VULNERABLE_RE.test(stdout);
  const parameterMatch = stdout.match(PARAMETER_RE);

  const techniques: string[] = [];
  for (const line of stdout.split('\n')) {
    const m = line.match(TECHNIQUE_RE);
    if (m) {
      const t = m[1].trim();
      if (!techniques.includes(t)) techniques.push(t);
    }
  }

  const payloadCount = (stdout.match(PAYLOAD_RE) ?? []).length;
  const dbmsMatch = combined.match(DBMS_RE);
  const dbms = dbmsMatch ? dbmsMatch[1].toLowerCase() : null;
  const noInjection = NO_INJECTION_RE.test(stdout) && !vulnerable;
  const authRequired = AUTH_REQUIRED_RE.test(combined) && !vulnerable;
  const connectionError = CONNECTION_RE.test(combined) && !vulnerable && !authRequired;
  const hasToolErrorText = TOOL_ERROR_RE.test(combined) || /\[PANIC\]/.test(combined);
  const toolError = hasToolErrorText && !vulnerable && !authRequired && !connectionError;
  const reached =
    parameterMatch !== null || vulnerable || noInjection || authRequired || /HTTP\/[12]\.\d/.test(stdout);

  return {
    vulnerable,
    parameter: parameterMatch?.[1] ?? null,
    method: parameterMatch?.[2]?.trim().toUpperCase() ?? null,
    techniques,
    payloadCount,
    dbms,
    noInjection,
    connectionError,
    authRequired,
    toolError,
    reached,
  };
}