import type {
  ScanStatus,
  StoredFinding,
  StoredRepository,
  StoredScan,
  ScannerStatistics,
} from '../models/scan';
import type { UnifiedFinding } from '../models/finding';

export interface CreateScanInput {
  readonly name: string;
  readonly repositoryUrl: string;
}

export interface CompleteScanInput {
  readonly status: Exclude<ScanStatus, 'PENDING'>;
  readonly completedAt: Date;
  readonly scannerStats: readonly ScannerStatistics[];
}

export interface ScanQueryResult {
  readonly scan: StoredScan;
  readonly findings: readonly StoredFinding[];
}

/**
 * Persistence port for scans and findings. Implemented by the Prisma adapter
 * in production and by an in-memory adapter in tests.
 */
export interface ScanRepository {
  upsertRepository(input: {
    readonly url: string;
    readonly name: string;
    readonly branch: string;
  }): Promise<StoredRepository>;

  createScan(input: CreateScanInput): Promise<StoredScan>;

  linkScanRepository(scanId: string, repositoryId: string): Promise<void>;

  markScanRunning(scanId: string, startedAt: Date): Promise<void>;

  completeScan(scanId: string, input: CompleteScanInput): Promise<void>;

  /** Persist normalized findings; returns the number saved. */
  saveFindings(scanId: string, findings: readonly UnifiedFinding[]): Promise<number>;

  getScan(scanId: string): Promise<StoredScan | null>;

  getScanResults(scanId: string): Promise<ScanQueryResult | null>;
}