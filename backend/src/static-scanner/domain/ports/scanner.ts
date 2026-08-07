import type { RawFinding, UnifiedFinding } from '../models/finding';
import type { ScanContext, ScannerRunResult } from '../models/scan';
import type { ScanTargetProfile } from '../models/scan-target';
import type { ScannerMetadata } from '../models/scanner-metadata';
import type { Severity } from '../models/severity';
import type { ScannerOutput } from './scanner-executor';

export interface ScannerConfig {
  readonly enabled: boolean;
  readonly timeoutMs: number;
  readonly severityThreshold: Severity;
  readonly extraArgs: readonly string[];
}

export interface ScannerCommand {
  /** Full argv for `execFile` (`[file, ...args]`). */
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  /** Whether this tool requires network egress; defaults to blocked. */
  readonly network?: boolean;
}

/**
 * The scanner abstraction. Every concrete scanner implements the same five
 * capabilities (`run`, `parse`, `normalize`, `buildCommand`, `metadata`) so
 * the rest of the system never special-cases a tool.
 */
export interface Scanner {
  readonly id: string;
  readonly engine: string;
  readonly metadata: ScannerMetadata;

  /** Whether this scanner should run for the given repository profile. */
  isApplicable(profile: ScanTargetProfile): boolean;

  /** Build the CLI command, or null to skip (e.g. no lockfile present). */
  buildCommand(context: ScanContext, config: ScannerConfig): ScannerCommand | null;

  /** Parse raw tool output into internal findings. */
  parse(output: ScannerOutput): readonly RawFinding[];

  /** Normalize parsed findings into the Unified Vulnerability Model. */
  normalize(findings: readonly RawFinding[], context: ScanContext): readonly UnifiedFinding[];

  /** Execute the scanner: build → run → parse → normalize. */
  run(context: ScanContext, config: ScannerConfig): Promise<ScannerRunResult>;
}