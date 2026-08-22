import type { UnifiedFinding } from './finding';
import type { Severity } from './severity';

export type ScanStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type ScannerRunStatus = 'completed' | 'failed' | 'skipped';

/** Everything a scanner needs to execute against one repository. */
export interface ScanContext {
  readonly scanId: string;
  readonly repositoryUrl: string;
  readonly repositoryName: string;
  /** Absolute path of the working tree being scanned. */
  readonly localPath: string;
  /** Findings below this severity are dropped. */
  readonly severityThreshold: Severity;
}

export interface ScannerRunResult {
  readonly scannerId: string;
  readonly engine: string;
  readonly status: ScannerRunStatus;
  readonly durationMs: number;
  readonly error: string | null;
  /** Normalized findings (already deduplicated within the scanner). */
  readonly findings: readonly UnifiedFinding[];
  /** Raw issue count as reported by the tool. */
  readonly rawItems: number;
}

export interface ScanSummary {
  readonly total: number;
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly info: number;
  readonly confirmed?: number;
}

export interface ScannerStatistics {
  readonly scannerId: string;
  readonly engine: string;
  readonly status: ScannerRunStatus;
  readonly durationMs: number;
  readonly findings: number;
}

export interface ScanResult {
  readonly scanId: string;
  readonly repository: { readonly name: string; readonly url: string };
  readonly status: ScanStatus;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly summary: ScanSummary;
  readonly scannerStatistics: readonly ScannerStatistics[];
  readonly findings: readonly UnifiedFinding[];
}

export interface ScanOverview {
  readonly scanId: string;
  readonly name: string;
  readonly status: ScanStatus;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly repository: { readonly name: string; readonly url: string } | null;
  readonly summary: ScanSummary;
  readonly scannerStatistics: readonly ScannerStatistics[];
}

// ---------------------------------------------------------------------------
// Persistence shapes (port contract, not tied to Prisma)
// ---------------------------------------------------------------------------

export interface StoredScan {
  readonly id: string;
  readonly name: string;
  readonly status: ScanStatus;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly scannerStats: readonly ScannerStatistics[];
  readonly repository: StoredRepository | null;
}

export interface StoredRepository {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly branch: string;
}

export interface StoredFinding {
  readonly id: string;
  readonly scanId: string;
  readonly scanner: string;
  readonly type: string;
  readonly severity: Severity;
  readonly status?: string;
  readonly confidence: number;
  readonly file: string | null;
  readonly line: number | null;
  readonly message: string;
  readonly cwe: string | null;
  readonly cve: string | null;
  readonly references: readonly string[];
  readonly evidence: string | null;
  readonly createdAt: Date;
  readonly patch?: {
    readonly id: string;
    readonly filePath: string | null;
    readonly diffContent: string | null;
    readonly explanation: string | null;
    readonly status: string;
  } | null;
}

export const EMPTY_SUMMARY: ScanSummary = {
  total: 0,
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
  confirmed: 0,
};

export function summarize(findings: readonly { severity: Severity; status?: string }[]): ScanSummary {
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let info = 0;
  let confirmed = 0;
  for (const finding of findings) {
    if (finding.status === 'CONFIRMED' || finding.status === 'EXPLOITABLE') {
      confirmed += 1;
    }
    switch (finding.severity) {
      case 'CRITICAL':
        critical += 1;
        break;
      case 'HIGH':
        high += 1;
        break;
      case 'MEDIUM':
        medium += 1;
        break;
      case 'LOW':
        low += 1;
        break;
      default:
        info += 1;
    }
  }
  const summary: ScanSummary = { total: findings.length, critical, high, medium, low, info };
  return confirmed > 0 ? { ...summary, confirmed } : summary;
}
