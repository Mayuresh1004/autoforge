import type { Severity } from './severity';

/**
 * Tool-specific finding shape produced by a scanner's `parse()` step.
 * Fields are intentionally loose — each tool emits slightly different data.
 * `normalize()` converts this into the Unified Vulnerability Model.
 */
export interface RawFinding {
  /** Scanner-specific type/code (e.g. `B608`, `CVE-2024-...`). */
  readonly type: string;
  /** Severity exactly as the tool emitted it (mapped later). */
  readonly severity: string;
  readonly confidence: number | null;
  /** Relative file path when the finding points at a file. */
  readonly file: string | null;
  readonly line: number | null;
  readonly message: string | null;
  readonly cwe: string | null;
  readonly cve: string | null;
  readonly references: readonly string[];
  /** Code/package evidence snippet, when available. */
  readonly evidence: string | null;
  /** Original tool record (kept for debugging, never exposed in the UVM). */
  readonly raw?: unknown;
}

/**
 * Unified Vulnerability Model — the canonical output of this phase.
 * Every scanner result is normalized into this shape.
 */
export interface UnifiedFinding {
  /** Stable, deterministic identifier (`vuln_<hash>`). */
  readonly id: string;
  /** Human-readable engine name that produced it (e.g. `Bandit`). */
  readonly scanner: string;
  /** Vulnerability type/code. */
  readonly type: string;
  readonly severity: Severity;
  /** 0..1 confidence (heuristic per scanner; never a security decision). */
  readonly confidence: number;
  readonly file: string | null;
  readonly line: number | null;
  readonly message: string;
  readonly cwe: string | null;
  readonly cve: string | null;
  readonly references: readonly string[];
  readonly evidence: string | null;
  readonly createdAt: string;
}
