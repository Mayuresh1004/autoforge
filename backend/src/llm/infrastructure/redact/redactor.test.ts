/**
 * Redactor tests: keys/tokens never survive, prompts are summarized and
 * truncated before any log line, and normal content passes through.
 */

import { describe, expect, it } from 'vitest';
import { redactSensitive, summarizePrompt, truncateField } from './redactor';

describe('redactSensitive', () => {
  it('redacts sk-/xr- style provider keys anywhere in the text', () => {
    expect(redactSensitive('key=sk-abcDEFghiJKLmnop1234567890 end')).toBe('key=[REDACTED] end');
    expect(redactSensitive('xr-abcdefghijklmnopqrstuvwxyz123456')).toContain('[REDACTED]');
  });

  it('redacts AIza-style Gemini keys', () => {
    expect(redactSensitive('GEMINI_API_KEY=AIzaSy0123456789abcdefghijklmnopqrstuv')).toContain('[REDACTED]');
    expect(redactSensitive('gemini key: AIzaSy0123456789abcdefghijklmnopqrstuv')).toBe('gemini key: [REDACTED]');
  });

  it('redacts Bearer tokens', () => {
    expect(redactSensitive('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')).toBe('Authorization: [REDACTED]');
  });

  it('redacts secret-ish assignments (api_key=…, password: …)', () => {
    expect(redactSensitive('api_key=super-secret-value')).toBe('api_key=[REDACTED]');
    expect(redactSensitive('password: "hunter2"')).toBe('password: [REDACTED]');
    expect(redactSensitive('"authorization": "Bearer tok123"')).toContain('[REDACTED]');
  });

  it('redacts long base64-ish blobs', () => {
    const blob = 'aGVsbG8gd29ybGQgdGhpcyBpcyBhIHZlcnkgbG9uZyBiYXNlNjQgYmxvYiB0aGF0IGxvb2tzIGxpa2UgYSBzZWNyZXQgdG9rZW4gb2Ygc29tZSBraW5k';
    expect(redactSensitive(`token=${blob}`)).toContain('[REDACTED]');
  });

  it('leaves ordinary text untouched', () => {
    const text = 'SELECT * FROM users WHERE id = 42;  // ordinary code comment';
    expect(redactSensitive(text)).toBe(text);
  });
});

describe('summarizePrompt', () => {
  it('produces a bounded head and never the full prompt', () => {
    const long = 'x'.repeat(10_000);
    const summary = summarizePrompt([
      { role: 'system', content: 'You are a helper' },
      { role: 'user', content: long },
    ]);
    expect(summary.messageCount).toBe(2);
    expect(summary.roles).toBe('system,user');
    expect(summary.totalChars).toBeGreaterThan(10_000);
    expect(summary.head.length).toBeLessThan(300);
    expect(summary.head).not.toContain(long);
  });

  it('redacts secrets that appear inside the prompt head', () => {
    const summary = summarizePrompt([{ role: 'user', content: 'my api key sk-abcdefghijklmnopqrst is kept inside' }]);
    expect(summary.head).not.toContain('sk-abcdefghijklmnopqrst');
    expect(summary.head).toContain('[REDACTED]');
  });
});

describe('truncateField', () => {
  it('limits length with an explicit marker', () => {
    const out = truncateField('abcdefgh', 4);
    expect(out).toBe('abcd…[+4 chars]');
  });

  it('keeps short strings as-is', () => {
    expect(truncateField('ok')).toBe('ok');
  });
});