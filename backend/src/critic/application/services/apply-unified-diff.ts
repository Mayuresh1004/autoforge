/**
 * Pure unified-diff application (no fuzz, no shell). Applies a single-file
 * diff deterministically inside the sandbox working copy; ANY context
 * mismatch aborts with a structured conflict — the Critic never tries to
 * "repair" a patch.
 *
 * Supported diff shape (the Engineer's strict validator guarantees it):
 *
 *   --- a/<path>
 *   +++ b/<path>
 *   @@ -a,b +c,d @@
 *   <context|removed|added lines>
 *
 * Rules: ' ' context, '-' removed, '+' added (order preserved),
 * '\ No newline at end of file' is accepted and ignored. No binary files,
 * no rename headers. Matching is STRICT (no fuzz): a single mismatched
 * context or removed line is a conflict.
 */

export type ApplyDiffOutcome =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly reason: string; readonly hunk?: number };

export interface ParsedHunk {
  readonly oldStart: number; // 1-based
  readonly oldCount: number;
  readonly newStart: number; // 1-based
  readonly newCount: number;
  /** Old-file line texts in diff order (context + removals). */
  readonly oldOrdered: readonly string[];
  /** New-file line texts in diff order (context + additions). */
  readonly newOrdered: readonly string[];
}

export type ParseResult = { readonly ok: true; readonly hunks: readonly ParsedHunk[] } | {
  readonly ok: false;
  readonly reason: string;
  readonly hunk?: number;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parse a unified diff body (after the ---/+++ headers) into hunks. */
export function parseUnifiedHunks(diff: string): ParseResult {
  const rawLines = diff.replace(/\r\n/g, '\n').split('\n');
  const hunks: ParsedHunk[] = [];
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];
    if (line.length === 0 || line.startsWith('diff --git') || line.startsWith('index ')) {
      i += 1;
      continue;
    }
    if (line.startsWith('---') || line.startsWith('+++')) {
      i += 1;
      continue;
    }
    const match = HUNK_HEADER.exec(line);
    if (!match) {
      return { ok: false, reason: `unexpected diff line: ${line.slice(0, 60)}` };
    }
    const oldStart = Number(match[1]);
    const oldCount = match[2] ? Number(match[2]) : 1;
    const newStart = Number(match[3]);
    const newCount = match[4] ? Number(match[4]) : 1;
    i += 1;
    const oldOrdered: string[] = [];
    const newOrdered: string[] = [];
    // Context lines appear ONCE in the diff body but count towards both
    // sides, so stop when both sides have collected their declared counts.
    while (i < rawLines.length && (oldOrdered.length < oldCount || newOrdered.length < newCount)) {
      const l = rawLines[i];
      if (l.length === 0) {
        // end of the hunk body (diff text ends with '\n') — never a context line
        i += 1;
        continue;
      }
      if (l.startsWith('\\ No newline')) {
        i += 1;
        continue;
      }
      if (l.startsWith('-')) {
        oldOrdered.push(l.slice(1));
      } else if (l.startsWith('+')) {
        newOrdered.push(l.slice(1));
      } else {
        // context line: strip the single leading ' ' marker
        oldOrdered.push(l.slice(1));
        newOrdered.push(l.slice(1));
      }
      i += 1;
    }
    if (oldOrdered.length !== oldCount || newOrdered.length !== newCount) {
      return { ok: false, reason: 'hunk counts do not match header', hunk: hunks.length + 1 };
    }
    hunks.push({ oldStart, oldCount, newStart, newCount, oldOrdered, newOrdered });
  }
  return { ok: true, hunks };
}

export interface ApplyUnifiedDiffInput {
  readonly base: string;
  readonly diff: string;
}

/**
 * Apply `diff` to `base`. Content lines declare no line endings: the base's
 * newline style (and trailing newline) is preserved. Any mismatch is a
 * conflict, exactly like `git apply --check` failing.
 */
export function applyUnifiedDiff(input: ApplyUnifiedDiffInput): ApplyDiffOutcome {
  const parsed = parseUnifiedHunks(input.diff);
  if (!parsed.ok) {
    return parsed;
  }
  if (parsed.hunks.length === 0) {
    return { ok: false, reason: 'no hunks found' };
  }

  const baseLines = splitLines(input.base);
  const trailingNewline = input.base.endsWith('\n');

  // Apply hunks in REVERSE order: hunk offsets refer to the ORIGINAL file,
  // so lower-offset hunks must still see the pre-patch text.
  let lines = baseLines;
  const ordered = [...parsed.hunks].sort((a, b) => b.oldStart - a.oldStart);
  for (const hunk of ordered) {
    const pos = hunk.oldStart - 1;
    if (pos < 0 || pos + hunk.oldCount > lines.length) {
      return { ok: false, reason: 'hunk starts out of file bounds', hunk: hunk.oldStart };
    }
    for (let k = 0; k < hunk.oldCount; k += 1) {
      if (lines[pos + k] !== hunk.oldOrdered[k]) {
        return { ok: false, reason: 'context mismatch', hunk: hunk.oldStart };
      }
    }
    lines = [
      ...lines.slice(0, pos),
      ...hunk.newOrdered,
      ...lines.slice(pos + hunk.oldCount),
    ];
  }

  return { ok: true, content: joinLines(lines, trailingNewline) };
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function joinLines(lines: readonly string[], trailingNewline: boolean): string {
  const content = lines.join('\n');
  return trailingNewline ? `${content}\n` : content;
}