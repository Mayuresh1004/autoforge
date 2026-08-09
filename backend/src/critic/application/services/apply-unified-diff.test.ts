/**
 * Unified-diff parser/applier — deterministic, no-fuzz application.
 * Hunks apply in REVERSE order (bottom-up) exactly like patch(1); any
 * context mismatch aborts the whole patch with a reason (never partial).
 */

import { describe, expect, it } from 'vitest';
import { applyUnifiedDiff } from './apply-unified-diff';

const BASE = [
  'import sqlite3',
  '',
  'def search(user_input):',
  '    conn = sqlite3.connect("app.db")',
  '    cur = conn.cursor()',
  '    query = "SELECT * FROM users WHERE id = " + user_input',
  '    cur.execute(query)',
  '    return ("hi",)',
  '',
].join('\n');

const FIXTURE_DIFF = `--- a/src/app.py
+++ b/src/app.py
@@ -6,3 +6,3 @@
     query = "SELECT * FROM users WHERE id = " + user_input
-    cur.execute(query)
+    cur.execute("SELECT * FROM users WHERE id = %s", (user_input,))
     return ("hi",)
`;

describe('applyUnifiedDiff', () => {
  it('applies a simple single-hunk diff', () => {
    const result = applyUnifiedDiff({ base: BASE, diff: FIXTURE_DIFF });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('cur.execute("SELECT * FROM users WHERE id = %s", (user_input,))');
    expect(result.content).not.toContain('cur.execute(query)');
  });

  it('applies multiple hunks bottom-up (order-independent line shifts)', () => {
    const base = 'line1\nline2\nline3\nline4\nline5\n';
    const multi = `--- a/f
+++ b/f
@@ -1,3 +1,3 @@
-line1
+LINE1
 line2
 line3
@@ -3,3 +3,3 @@
 line3
-line4
+LINE4
 line5
`;
    const result = applyUnifiedDiff({ base, diff: multi });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe('LINE1\nline2\nline3\nLINE4\nline5\n');
  });

  it('rejects when context does not match (no fuzz, never silent)', () => {
    const result = applyUnifiedDiff({ base: 'a\nb\nc\n', diff: FIXTURE_DIFF });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBeTruthy();
  });

  it('rejects an empty diff', () => {
    const result = applyUnifiedDiff({ base: BASE, diff: '' });
    expect(result.ok).toBe(false);
  });

  it('rejects diffs with no hunks', () => {
    const result = applyUnifiedDiff({ base: BASE, diff: '--- a/f\n+++ b/f\n' });
    expect(result.ok).toBe(false);
  });

  it('accepts LF-only and CRLF content', () => {
    const crlf = BASE.replace(/\n/g, '\r\n');
    const result = applyUnifiedDiff({ base: crlf, diff: FIXTURE_DIFF });
    expect(result.ok).toBe(true);
  });

  it('applies additions-only hunks', () => {
    const base = 'a\nb\n';
    const diff = [
      '--- a/f',
      '+++ b/f',
      '@@ -1,2 +1,3 @@',
      ' a',
      ' b',
      '+import os',
      '',
    ].join('\n');
    const result = applyUnifiedDiff({ base, diff });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe('a\nb\nimport os\n');
  });
});