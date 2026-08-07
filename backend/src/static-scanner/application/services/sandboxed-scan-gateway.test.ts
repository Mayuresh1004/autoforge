import { describe, it, expect, vi } from 'vitest';
import { SandboxedScanGateway } from './sandboxed-scan-gateway';
import type { SandboxedScanOrchestrator } from '../../../sandbox/application/services/sandboxed-scan-orchestrator';
import type { StaticScanGateway } from '../ports/static-scan-gateway';
import type { ScanOverview, ScanResult, ScannerStatistics, StoredFinding } from '../../domain/models/scan';

describe('SandboxedScanGateway', () => {
  it('routes creation to the sandboxed orchestrator and reads to ScanService', async () => {
    const scanResult = { scanId: 'scan_sb1' } as ScanResult;
    const overview = { scanId: 'scan_sb1', name: 'x' } as ScanOverview;
    const findings = [] as readonly StoredFinding[];
    const stats = {
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      scannerStatistics: [] as readonly ScannerStatistics[],
    };

    const orchestrator = {
      runScan: vi.fn().mockResolvedValue(scanResult),
    } as unknown as SandboxedScanOrchestrator;
    const reads = {
      getScanOverview: vi.fn().mockResolvedValue(overview),
      getScanFindings: vi.fn().mockResolvedValue(findings),
      getScanStatistics: vi.fn().mockResolvedValue(stats),
    } as unknown as ScanServiceShape;

    const gateway: StaticScanGateway = new SandboxedScanGateway(
      orchestrator,
      reads as unknown as Parameters<typeof SandboxedScanGateway>[1]
    );

    const url = 'https://github.com/acme/repo';
    await expect(gateway.runStaticScan(url)).resolves.toBe(scanResult);
    expect(orchestrator.runScan).toHaveBeenCalledWith(url);

    await expect(gateway.getScanOverview('sb1')).resolves.toBe(overview);
    await expect(gateway.getScanFindings('sb1')).resolves.toBe(findings);
    await expect(gateway.getScanStatistics('sb1')).resolves.toBe(stats);
    expect(reads.getScanOverview).toHaveBeenCalledWith('sb1');
  });
});

type ScanServiceShape = {
  getScanOverview(scanId: string): Promise<ScanOverview | null>;
  getScanFindings(scanId: string): Promise<readonly StoredFinding[] | null>;
  getScanStatistics(scanId: string): Promise<{
    summary: { total: number; critical: number; high: number; medium: number; low: number; info: number };
    scannerStatistics: readonly ScannerStatistics[];
  } | null>;
};