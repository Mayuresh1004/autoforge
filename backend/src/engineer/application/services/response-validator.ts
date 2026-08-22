/**
 * Deterministic structural validation of the model's LLM response. NO LLM
 * used. Guarantees before persistence:
 *  - valid bounded status (GENERATED | REJECTED) and required fields
 *  - vulnerabilityId matches the requested finding
 *  - filePath is a safe repository-relative path
 *  - GENERATED → diff is a bounded unified diff with safe, supported targets
 *  - no path traversal / absolute host paths / binary or lockfile targets
 *  - no obviously unrelated file set
 *  - explanation present, assumptions bounded
 *
 * This is STRUCTURAL safety only — proving the patch is actually secure is
 * later phases' responsibility (Critic). Malformed output is NEVER persisted
 * as GENERATED.
 */

import type { EngineerBounds, EngineerResponse } from '../../domain/models/engineer-response';
import { DEFAULT_ENGINEER_BOUNDS, isEngineerPatchStatus } from '../../domain/models/engineer-response';
import { isSupportedCodeFile, normalizeRepoPath } from '../../domain/models/repo-path';
import { buildUnifiedDiff } from './diff-builder';

export interface EngineerValidationExpectation {
  readonly vulnerabilityId: string;
  /** Expected type label (e.g. SQL_INJECTION). */
  readonly type?: string;
  /** Expected repo-relative file from the static finding (nullable). */
  readonly filePath: string | null;
}

export type EngineerValidationResult =
  | { readonly ok: true; readonly response: EngineerResponse }
  | { readonly ok: false; readonly failures: readonly string[] };

/**
 * Structural validation of parsed model output against the run expectation.
 * A non-ok result means the output must not be persisted as GENERATED.
 */
export function validateEngineerResponse(
  raw: unknown,
  expected: EngineerValidationExpectation,
  bounds: EngineerBounds = DEFAULT_ENGINEER_BOUNDS,
): EngineerValidationResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, failures: ['response must be a JSON object'] };
  }
  const record = raw as Record<string, unknown>;

  const status = record.status;
  if (!isEngineerPatchStatus(status)) {
    return { ok: false, failures: [`status must be GENERATED or REJECTED, got: ${JSON.stringify(status)}`] };
  }

  const vulnerabilityId = record.vulnerabilityId;
  if (typeof vulnerabilityId !== 'string' || vulnerabilityId.length === 0 || vulnerabilityId.length > 128) {
    return { ok: false, failures: ['vulnerabilityId is required (string, ≤128 chars)'] };
  }
  if (vulnerabilityId !== expected.vulnerabilityId) {
    return {
      ok: false,
      failures: [`vulnerabilityId ${JSON.stringify(vulnerabilityId)} is not the requested finding ${expected.vulnerabilityId}`],
    };
  }

  const assumptionsRaw = Array.isArray(record.assumptions)
    ? record.assumptions.filter((a): a is string => typeof a === 'string')
    : [];
  if (assumptionsRaw.length > bounds.maxAssumptions) {
    return { ok: false, failures: [`assumptions exceeds ${bounds.maxAssumptions} items`] };
  }
  const assumptions = assumptionsRaw.slice(0, bounds.maxAssumptions).map((a) => a.slice(0, 300));

  if (status === 'REJECTED') {
    const reason = typeof record.reason === 'string' ? record.reason.trim() : (typeof record.explanation === 'string' ? record.explanation.trim() : '');
    if (reason.length === 0) {
      return { ok: false, failures: ['REJECTED responses require a non-empty reason'] };
    }
    if (record.filePath != null || record.diff != null) {
      return { ok: false, failures: ['REJECTED responses must not include filePath/diff'] };
    }
    const explanation = typeof record.explanation === 'string' && record.explanation.trim().length > 0
      ? record.explanation.trim()
      : reason;
    const remediation = typeof record.remediation === 'string' && record.remediation.trim().length > 0
      ? record.remediation.trim()
      : 'parameterized query';

    return {
      ok: true,
      response: {
        vulnerabilityId,
        status: 'REJECTED',
        filePath: null,
        diff: null,
        explanation,
        remediation,
        assumptions,
        reason: reason.slice(0, 1_000),
      },
    };
  }

  const explanation = typeof record.explanation === 'string' ? record.explanation : '';
  if (explanation.trim().length === 0) {
    return { ok: false, failures: ['explanation is required'] };
  }
  if (explanation.length > bounds.maxExplanationChars) {
    return { ok: false, failures: [`explanation exceeds ${bounds.maxExplanationChars} chars`] };
  }
  const remediation = typeof record.remediation === 'string' ? record.remediation.trim() : '';
  if (remediation.length === 0) {
    return { ok: false, failures: ['remediation is required (e.g. parameterized query)'] };
  }

  // ---- GENERATED ----------------------------------------------------------
  const filePathRaw = typeof record.filePath === 'string' ? record.filePath : null;
  const filePath = filePathRaw ? normalizeRepoPath(filePathRaw) : null;
  
  const originalCode = typeof record.originalCode === 'string' ? record.originalCode : null;
  const patchedCode = typeof record.patchedCode === 'string' ? record.patchedCode : null;
  let diff = typeof record.diff === 'string' ? record.diff.trim() : '';

  const failures: string[] = [];
  if (!filePathRaw) {
    failures.push('filePath is required for GENERATED');
  } else if (!filePath) {
    failures.push(`unsafe (non repo-relative) filePath: ${JSON.stringify(filePathRaw)}`);
  } else if (!isSupportedCodeFile(filePath)) {
    failures.push(`unsupported file target ${filePath} (binary/lock files are never patched)`);
  }

  const expectedFile = expected.filePath ? normalizeRepoPath(expected.filePath) : null;
  if (expectedFile && filePath && filePath !== expectedFile) {
    failures.push(`filePath ${filePath} does not match the finding target ${expectedFile}`);
  }

  if (originalCode !== null && patchedCode !== null && filePath) {
    if (originalCode.trim().length === 0 || patchedCode.trim().length === 0) {
      failures.push('originalCode and patchedCode must be non-empty strings');
    } else if (originalCode === patchedCode) {
      failures.push('originalCode and patchedCode are identical (no changes made)');
    } else {
      diff = buildUnifiedDiff(filePath, originalCode, patchedCode);
    }
  } else if (!diff) {
    failures.push('originalCode and patchedCode are required for GENERATED');
  }

  if (diff.length === 0) {
    failures.push('diff is required (GENERATED)');
  } else {
    failures.push(...validateDiffShape(diff, bounds));
    for (const target of diffFileTargets(diff)) {
      const normalized = normalizeRepoPath(target);
      if (normalized && filePath && normalized !== filePath) {
        failures.push(`diff touches unrelated file ${target} (expected ${filePath})`);
      }
    }
  }

  if (failures.length > 0) return { ok: false, failures };

  return {
    ok: true,
    response: {
      vulnerabilityId,
      status: 'GENERATED',
      filePath,
      diff,
      originalCode,
      patchedCode,
      explanation: explanation.trim(),
      remediation,
      assumptions,
      reason: null,
    },
  };
}

/** File paths declared by `+++` lines of a unified diff. */
export function diffFileTargets(diff: string): string[] {
  const targets: string[] = [];
  for (const line of diff.split('\n')) {
    const match = line.match(/^\+\+\+\s+(?:a\/|b\/)?(.+)$/);
    if (match) targets.push(match[1]);
  }
  return targets;
}

/** Unified-diff structural checks (pure, deterministic). */
export function validateDiffShape(
  diff: string,
  bounds: Pick<EngineerBounds, 'maxDiffChars' | 'maxPatchFiles'>,
): string[] {
  if (diff.length > bounds.maxDiffChars) {
    return [`diff exceeds the ${bounds.maxDiffChars}-char bound`];
  }
  const lines = diff.split('\n');
  const hasHeader = lines.some((l) => l.startsWith('--- '));
  const hasTarget = lines.some((l) => l.startsWith('+++ '));
  const hasHunk = lines.some((l) => l.startsWith('@@ '));
  if (!hasHeader || !hasTarget || !hasHunk) {
    return ['diff is not shaped like a unified diff (missing ---/+++/@@)'];
  }

  const touched = new Set<string>();
  for (const line of lines) {
    const match = line.match(/^\+\+\+\s+(?:a\/|b\/)?(.+)$/);
    if (match) touched.add(match[1]);
  }
  if (touched.size === 0) return ['diff has no file target'];

  const problems: string[] = [];
  for (const raw of touched) {
    const normalized = normalizeRepoPath(raw);
    if (!normalized) {
      problems.push(`unsafe path in diff: ${raw}`);
      continue;
    }
    if (!isSupportedCodeFile(normalized)) {
      problems.push(`unsupported target in diff: ${raw}`);
    }
  }
  if (problems.length > 0) return problems;

  if (touched.size > bounds.maxPatchFiles) {
    return [`diff touches ${touched.size} files (max ${bounds.maxPatchFiles}) — likely unrelated changes`];
  }
  return [];
}