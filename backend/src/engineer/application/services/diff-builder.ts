/**
 * Deterministic unified diff generator (pure TypeScript, zero external dependencies).
 * Generates standard unified diffs with --- a/<path>, +++ b/<path>, and @@ hunk headers.
 */
export function buildUnifiedDiff(
  filePath: string,
  originalCode: string,
  patchedCode: string
): string {
  const normPath = filePath.replace(/^\/+/, '');
  const origLines = originalCode.length === 0 ? [] : originalCode.split('\n');
  const patchLines = patchedCode.length === 0 ? [] : patchedCode.split('\n');

  // Handle empty original or empty patched code explicitly
  if (origLines.length === 0 && patchLines.length === 0) {
    return '';
  }

  // Find common prefix lines
  let prefixCount = 0;
  while (
    prefixCount < origLines.length &&
    prefixCount < patchLines.length &&
    origLines[prefixCount] === patchLines[prefixCount]
  ) {
    prefixCount++;
  }

  // Find common suffix lines
  let origSuffix = origLines.length - 1;
  let patchSuffix = patchLines.length - 1;
  while (
    origSuffix >= prefixCount &&
    patchSuffix >= prefixCount &&
    origLines[origSuffix] === patchLines[patchSuffix]
  ) {
    origSuffix--;
    patchSuffix--;
  }

  // Context lines before and after change
  const contextBeforeStart = Math.max(0, prefixCount - 3);
  const contextBefore = origLines.slice(contextBeforeStart, prefixCount);
  
  const contextAfterEnd = Math.min(origLines.length, origSuffix + 4);
  const contextAfter = origLines.slice(origSuffix + 1, contextAfterEnd);

  const origChange = origLines.slice(prefixCount, origSuffix + 1);
  const patchChange = patchLines.slice(prefixCount, patchSuffix + 1);

  const origCount = contextBefore.length + origChange.length + contextAfter.length;
  const patchCount = contextBefore.length + patchChange.length + contextAfter.length;

  const startLine = Math.max(1, contextBeforeStart + 1);

  const lines: string[] = [
    `--- a/${normPath}`,
    `+++ b/${normPath}`,
    `@@ -${startLine},${origCount} +${startLine},${patchCount} @@`,
  ];

  contextBefore.forEach((l) => lines.push(` ${l}`));
  origChange.forEach((l) => lines.push(`-${l}`));
  patchChange.forEach((l) => lines.push(`+${l}`));
  contextAfter.forEach((l) => lines.push(` ${l}`));

  return lines.join('\n');
}
