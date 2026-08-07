import type {
  ScanOverview,
  ScanResult,
  ScannerStatistics,
  StoredFinding,
} from '../../domain/models/scan';
import { summarize } from '../../domain/models/scan';
import type { StaticScanGateway } from '../ports/static-scan-gateway';
import type { SandboxedScanOrchestrator } from '../../../sandbox/application/services/sandboxed-scan-orchestrator';
import type { ScanService } from './scan.service';

/**
 * Routes creation through the sandboxed pipeline (one manager-owned analysis
 * sandbox per scan) while reads continue to the classic service, which owns
 * the persisted-results queries. Keeps the HTTP transport behind the single
 * `StaticScanGateway` port.
 */
export class SandboxedScanGateway implements StaticScanGateway {
  constructor(
    private readonly orchestrator: SandboxedScanOrchestrator,
    private readonly reads: ScanService
  ) {}

  async runStaticScan(repositoryUrl: string): Promise<ScanResult> {
    return this.orchestrator.runScan(repositoryUrl);
  }

  async getScanOverview(scanId: string): Promise<ScanOverview | null> {
    return this.reads.getScanOverview(scanId);
  }

  async getScanFindings(scanId: string): Promise<readonly StoredFinding[] | null> {
    return this.reads.getScanFindings(scanId);
  }

  async getScanStatistics(scanId: string): Promise<{
    summary: ReturnType<typeof summarize>;
    scannerStatistics: readonly ScannerStatistics[];
  } | null> {
    return this.reads.getScanStatistics(scanId);
  }
}