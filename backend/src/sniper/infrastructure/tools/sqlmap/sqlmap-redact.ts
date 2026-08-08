/**
 * Redaction + truncation for tool output before it is persisted or logged.
 * Full HTTP responses are never stored; credentials-like material is masked.
 */

const SENSITIVE_LINE =
  /(authorization|set-cookie|session|cookie|api[_-]?key|password|passwd|token|secret|credential)\s*[:=][^\n]*/i;

/** Mask any line that looks like it carries a secret (keeps context). */
export function redactSecrets(text: string): string {
  return text
    .split('\n')
    .map((line) => (SENSITIVE_LINE.test(line) ? line.replace(SENSITIVE_LINE, '$1: [redacted]') : line))
    .join('\n');
}

/** Truncate + redact to a reviewer-friendly summary (default 4 KB). */
export function summarizeOutput(text: string, maxBytes = 4_000): string {
  const redacted = redactSecrets(text);
  const firstLine = redacted.split('\n')[0] ?? '';
  if (redacted.length <= maxBytes) return redacted;
  // Keep the head (sqlmap verdicts live early) and note the cut.
  const head = redacted.slice(0, Math.max(0, maxBytes - 40));
  return `${head}\n…[output truncated: ${redacted.length} bytes total]`;
}

/** Default envs the sqlmap adapter needs inside a sandbox. */
export const SQLMAP_ENV = {
  HOME: '/tmp',
  PYTHONDONTWRITEBYTECODE: '1',
  SQLMAP_OUTPUT_PATH: '/tmp/sqlmap-out',
} as const;