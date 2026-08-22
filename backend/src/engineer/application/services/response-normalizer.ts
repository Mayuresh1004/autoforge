/**
 * Robust LLM Response Normalizer for Engineer.
 *
 * Normalizes responses from LLM providers (Gemini, OpenRouter, Groq, Mistral, OpenAI)
 * into a clean JavaScript object before structural validation. Handles:
 *  - Already-parsed JSON objects
 *  - Raw JSON strings
 *  - Markdown code-fenced strings (```json ... ``` or ``` ... ```)
 *  - Embedded JSON objects surrounded by text
 *  - Provider-specific content wrapper objects ({ text }, { content }, { response }, { choices }, { candidates })
 *  - Double-encoded JSON strings
 */

export function normalizeEngineerLlmResponse(rawInput: unknown): unknown {
  let current: unknown = rawInput;

  // 1. If passed string, parse it
  if (typeof current === 'string') {
    current = parseJsonFromText(current);
  }

  // 2. Handle double-encoded JSON string
  if (typeof current === 'string') {
    current = parseJsonFromText(current);
  }

  // 3. Handle object & provider wrapper normalization
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    const record = current as Record<string, unknown>;

    // If it already looks like an Engineer response payload, return it
    if ('status' in record || 'vulnerabilityId' in record) {
      return record;
    }

    // Provider wrapper extractions
    if ('response' in record && record.response != null) {
      return normalizeEngineerLlmResponse(record.response);
    }
    if ('content' in record && record.content != null) {
      return normalizeEngineerLlmResponse(record.content);
    }
    if ('message' in record && record.message != null) {
      return normalizeEngineerLlmResponse(record.message);
    }
    if ('text' in record && typeof record.text === 'string') {
      return normalizeEngineerLlmResponse(record.text);
    }
    if ('data' in record && record.data != null) {
      return normalizeEngineerLlmResponse(record.data);
    }
    if (Array.isArray(record.choices) && record.choices.length > 0) {
      const choice = record.choices[0];
      if (choice && typeof choice === 'object') {
        const msg = (choice as Record<string, unknown>).message ?? (choice as Record<string, unknown>).text;
        if (msg) return normalizeEngineerLlmResponse(msg);
      }
    }
    if (Array.isArray(record.candidates) && record.candidates.length > 0) {
      const candidate = record.candidates[0] as Record<string, unknown>;
      const content = candidate?.content as Record<string, unknown>;
      if (Array.isArray(content?.parts) && content.parts.length > 0) {
        const part = content.parts[0] as Record<string, unknown>;
        if (part?.text) return normalizeEngineerLlmResponse(part.text);
      }
    }
  }

  return current;
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  // 1. Try direct JSON parse
  try {
    return JSON.parse(trimmed);
  } catch {}

  // 2. Strip outer markdown code fences (```json ... ``` or ``` ... ```)
  const strippedFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(strippedFence);
  } catch {}

  // 3. Strip line-by-line fences
  const strippedLines = trimmed
    .split('\n')
    .filter((line) => !/^\s*```(?:json)?\s*$/i.test(line))
    .join('\n')
    .trim();

  try {
    return JSON.parse(strippedLines);
  } catch {}

  // 4. Substring extraction from first '{' to last '}'
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {}
  }

  return null;
}
