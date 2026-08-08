/**
 * Wire-level parsing and error classification for OpenAI-compatible chat
 * completions (shared by OpenRouter / Groq / Mistral).
 *
 * Everything here is pure: payload in, typed result or classified LLMError
 * out. Error details derived from provider bodies are REDACTED — providers
 * sometimes echo request content (including key material) back in errors.
 */

import {
  LLMAuthenticationError,
  LLMError,
  LLMMalformedRequestError,
  LLMModelUnavailableError,
  LLMPolicyError,
  LLMRateLimitError,
  LLMResponseError,
  LLMUnavailableError,
} from '../../domain/errors/llm.errors';
import type { LLMProviderId } from '../../domain/ports/llm-provider';
import { redactSensitive } from '../redact/redactor';

export interface ParsedChatResponse {
  readonly text: string;
  readonly finishReason: string;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  /** Provider-reported cost (0 when absent — never invented). */
  readonly cost: number | undefined;
}

/** Error codes meaning the requested model is not (currently) served —
 *  free models rotate, so this is transient enough to try a fallback. */
const MODEL_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'model_not_found',
  'unknown_model',
  'model_not_available',
  'model_not_supported',
  'model_not_found_error',
]);

/** Error codes meaning the prompt was rejected by content policy — would
 *  recur on every provider. */
const POLICY_CODES: ReadonlySet<string> = new Set(['content_filter', 'mod_request']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Classify an HTTP failure into the LLM error taxonomy. All body-derived
 *  text is redacted first. */
export function classifyHttpError(
  provider: LLMProviderId,
  status: number,
  bodyText: string,
  model: string,
): LLMError {
  const message = redactSensitive(truncate(bodyText, 200));
  const code = extractErrorCode(bodyText);
  if (status === 401 || status === 403) {
    return new LLMAuthenticationError(provider, message);
  }
  if (status === 429) {
    return new LLMRateLimitError(provider, message, extractRetryAfter(bodyText));
  }
  if (status === 404 || (code !== null && MODEL_UNAVAILABLE_CODES.has(code))) {
    return new LLMModelUnavailableError(provider, model, message);
  }
  if (status >= 500) {
    return new LLMUnavailableError(provider, `status ${status}`);
  }
  if (code !== null && POLICY_CODES.has(code)) {
    return new LLMPolicyError(provider, message);
  }
  // Remaining 4xx: bad params, context too long, unsupported features — a
  // request problem that would repeat on any provider.
  return new LLMMalformedRequestError(provider, message);
}

/** Parse a 200 chat-completions body. Throws LLMResponseError when the
 *  payload is unusable (likely a provider/app breakage — not fallback-safe). */
export function parseChatResponse(
  provider: LLMProviderId,
  bodyText: string,
): ParsedChatResponse {
  let data: unknown;
  try {
    data = JSON.parse(bodyText) as unknown;
  } catch {
    throw new LLMResponseError(
      provider,
      'response was not JSON',
      new BodyErrorText(redactSensitive(truncate(bodyText, 120))),
    );
  }
  return extractChatResponse(provider, data, bodyText);
}

export function extractChatResponse(
  provider: LLMProviderId,
  data: unknown,
  bodyText: string,
): ParsedChatResponse {
  const root = asRecord(data);
  const usage = asRecord(root?.['usage']);
  const choices = root?.['choices'];
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new LLMResponseError(
      provider,
      'missing choices[0].message.content',
      new BodyErrorText(redactSensitive(truncate(bodyText, 120))),
    );
  }
  const first = asRecord(choices[0]);
  const message = asRecord(first?.['message']);
  const text = asString(message?.['content']);
  if (text === null) {
    throw new LLMResponseError(
      provider,
      'missing choices[0].message.content',
      new BodyErrorText(redactSensitive(truncate(bodyText, 120))),
    );
  }
  const finishReason = asString(first?.['finish_reason']) ?? 'stop';
  const rawInput = asRecord(usage)?.['prompt_tokens'];
  const rawOutput = asRecord(usage)?.['completion_tokens'];
  const costRaw = usage?.['cost'];
  const cost = typeof costRaw === 'number' ? costRaw : typeof costRaw === 'string' ? Number(costRaw) : NaN;
  return {
    text,
    finishReason,
    inputTokens: typeof rawInput === 'number' ? rawInput : undefined,
    outputTokens: typeof rawOutput === 'number' ? rawOutput : undefined,
    cost: Number.isFinite(cost) ? cost : undefined,
  };
}

function extractErrorCode(bodyText: string): string | null {
  try {
    const root = asRecord(JSON.parse(bodyText) as unknown);
    const error = asRecord(root?.['error']);
    return asString(error?.['code']) ?? null;
  } catch {
    return null;
  }
}

function extractRetryAfter(bodyText: string): number | undefined {
  const match = /"retry_after"\s*:\s*([0-9.]+)/.exec(bodyText);
  return match ? Number(match[1]) : undefined;
}

/** Internal cause wrapper so ResponseError carries redacted context. */
class BodyErrorText extends Error {
  constructor(text: string) {
    super(`provider body: ${text}`);
    this.name = 'BodyErrorText';
  }
}