import type { Scanner } from './scanner';
import type { ScanContext, ScannerRunResult } from '../models/scan';

/**
 * Runs a set of scanners against a repository, isolating failures so one
 * scanner never aborts the scan.
 */
export interface ScannerRunnerPort {
  runAll(scanners: readonly Scanner[], context: ScanContext): Promise<ScannerRunResult[]>;
}