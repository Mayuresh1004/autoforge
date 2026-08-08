/**
 * Source-window computation — pure. The source reader may be asked for a
 * specific window around a static finding's line; this clamps it to
 * [1, +∞), chooses a sensible default window, and guarantees the result line
 * count stays bounded (the caller caps it again at read time).
 */

export const DEFAULT_CONTEXT_WINDOW = 12; // lines around a finding (each side)

export interface SourceWindow {
  readonly startLine: number;
  readonly endLine: number;
  /** True when the requested window exceeded maxLines and was clamped. */
  readonly clamped: boolean;
}

export function resolveWindow(
  lineNumber: number | null,
  options?: {
    readonly startLine?: number | null;
    readonly endLine?: number | null;
    readonly window?: number;
    readonly maxLines?: number;
  },
): SourceWindow {
  const window = Math.max(1, options?.window ?? DEFAULT_CONTEXT_WINDOW);
  const maxLines = Math.max(window, options?.maxLines ?? 150);

  let start: number;
  let end: number;

  if (options?.startLine != null && options?.endLine != null) {
    start = Math.max(1, options.startLine);
    end = Math.max(start, options.endLine);
  } else if (lineNumber != null) {
    start = Math.max(1, lineNumber - window);
    end = lineNumber + window;
  } else {
    start = 1;
    end = start + maxLines - 1;
  }

  if (end - start + 1 > maxLines) {
    end = start + maxLines - 1;
    return { startLine: start, endLine: end, clamped: true };
  }
  if (end < start) end = start;
  const clamped = end - start + 1 > maxLines;
  return { startLine: start, endLine: end, clamped };
}

/** Line-window helper for tests + docs: keep the finding line centered. */
export function centeredWindow(line: number, window: number): { start: number; end: number } {
  return { start: Math.max(1, line - window), end: line + window };
}

/** Apply a window to raw file lines (1-based). */
export function sliceLines(
  allLines: readonly string[],
  window: SourceWindow,
): { lines: readonly string[]; offset: number } {
  const startIdx = Math.max(0, window.startLine - 1);
  const endIdx = Math.min(allLines.length, window.endLine);
  return { lines: allLines.slice(startIdx, endIdx), offset: startIdx + 1 };
}