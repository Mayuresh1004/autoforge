import type {
  ScanOverview,
  ScanResult,
  ScannerStatistics,
  StoredFinding,
} from '../../domain/models/scan';
import { summarize } from '../../domain/models/scan';

/**
 * The controller-facing contract for a static-scan run. A single method
 * creates the scan (the underlying implementation may be the classic
 * preparer-cloned path or the sandboxed orchestrator) and the three query
 * methods read persisted results. The controller depends only on this port.
 */
export interface StaticScanGateway {
  startStaticScan?(repositoryUrl: string): Promise<{ scanId: string; status: string }>;
  runStaticScan(repositoryUrl: string): Promise<ScanResult>;
  getScanOverview(scanId: string): Promise<ScanOverview | null>;
  getScanFindings(scanId: string): Promise<readonly StoredFinding[] | null>;
  getScanStatistics(scanId: string): Promise<{
    summary: ReturnType<typeof summarize>;
    scannerStatistics: readonly ScannerStatistics[];
  } | null>;
}