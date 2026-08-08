/**
 * Log-safety helpers for the LLM module.
 *
 * Policy:
 *  - API keys, authorization tokens and credential-looking values are never
 *    logged. `redactSensitive(text)` strips them from any string before it
 *    reaches a logger.
 *  - Prompt/responses are treated as potentially sensitive (repository source
 *    code may appear inside them). Logs only ever carry a bounded
 *    `summarizeMessages()` view — role counts, a redacted head and char count
 *    — never full content.
 */

const REDACTED = '[REDACTED]';

/** Patterns WITHOUT capture groups: the whole match becomes [REDACTED]. */
const PLAIN_PATTERNS: readonly RegExp[] = [
  // sk-…/xr-… style API keys.
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bxr-[A-Za-z0-9_-]{8,}\b/g,
  // Gemini-style API keys (AIza…, typically 39 chars).
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  // Bearer tokens (dots/slashes/tildes/pluses allowed).
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  // Long base64-ish blobs.
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
];

/** Capture groups 1=key name, 2=separator, 3=value — value is redacted,
 *  key name + separator are preserved so logs stay readable. */
const ASSIGNMENT_PATTERN =
  /\b(api[_-]?key|apikey|secret|authorization|token|password)(\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,{}\[]+)/gi;

/** Replace any sensitive value inside `text` with a marker. */
export function redactSensitive(text: string): string {
  let out = text;
  for (const pattern of PLAIN_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  out = out.replace(ASSIGNMENT_PATTERN, (_match, key: string, sep: string) => `${key}${sep}${REDACTED}`);
  return out;
}

/** Never log more than this many characters of any single string. */
export const MAX_SINGLE_FIELD_CHARS = 240;

export function truncateField(value: string, max = MAX_SINGLE_FIELD_CHARS): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[+${value.length - max} chars]`;
}

export interface PromptSummary {
  readonly roles: string;
  readonly messageCount: number;
  readonly head: string;
  readonly totalChars: number;
}

const MAX_PROMPT_HEAD_CHARS = 160;

/**
 * A bounded, redacted summary of a prompt suitable for DEBUG logs. Never
 * contains the full prompt — repository source code must not be shipped to
 * logs (or to providers unnecessarily; the caller controls what it sends).
 */
export function summarizePrompt(messages: readonly { readonly role: string; readonly content: string }[]): PromptSummary {
  const roles = messages.map((m) => m.role).join(',');
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const head = messages
    .map((m) => m.content)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_PROMPT_HEAD_CHARS);
  return {
    roles,
    messageCount: messages.length,
    head: redactSensitive(head),
    totalChars,
  };
}