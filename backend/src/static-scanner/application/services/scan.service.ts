import { logger } from '../../../config/logger';
import type { Severity } from '../../domain/models/severity';
import type {
  ScanOverview,
  ScanResult,
  ScannerStatistics,
  StoredFinding,
} from '../../domain/models/scan';
import { summarize } from '../../domain/models/scan';
import type { ScannerRegistry } from '../../domain/ports/scanner-registry';
import type { ScannerRunnerPort } from '../../domain/ports/scanner-runner';
import type { FindingDeduplicator } from '../../domain/ports/deduplicator';
import type { ScanRepository } from '../../domain/ports/scan-repository';
import type { RepositoryPreparer } from '../ports/repository-preparer';
import { runScannerFlow, toScanTargetProfile } from './scan-flow';

export interface ScanServiceOptions {
  readonly preparer: RepositoryPreparer;
  readonly registry: ScannerRegistry;
  readonly runner: ScannerRunnerPort;
  readonly deduplicator: FindingDeduplicator;
  readonly repository: ScanRepository;
  readonly severityThreshold: Severity;
}

/**
 * Orchestrates a static scan: prepare (clone+analyze) → select scanners →
 * run (isolated failures) → normalize → deduplicate → persist → summarize.
 * Never makes security decisions; it only executes deterministic scanners.
 */
export class ScanService {
  private readonly preparer: RepositoryPreparer;
  private readonly registry: ScannerRegistry;
  private readonly runner: ScannerRunnerPort;
  private readonly deduplicator: FindingDeduplicator;
  private readonly repository: ScanRepository;
  private readonly severityThreshold: Severity;

  constructor(options: ScanServiceOptions) {
    this.preparer = options.preparer;
    this.registry = options.registry;
    this.runner = options.runner;
    this.deduplicator = options.deduplicator;
    this.repository = options.repository;
    this.severityThreshold = options.severityThreshold;
  }

  async runStaticScan(repositoryUrl: string): Promise<ScanResult> {
    logger.info({ repositoryUrl }, 'scan.static:started');

    const prepared = await this.preparer.prepareRepository(repositoryUrl);
    let scanId: string | undefined;

    try {
      const target = toScanTargetProfile(prepared.profile);
      const store = await this.repository.createScan({
        name: prepared.profile.meta.name,
        repositoryUrl,
      });
      scanId = store.id;
      const startedAt = new Date();
      await this.repository.markScanRunning(scanId, startedAt);

      const result = await runScannerFlow(
        {
          registry: this.registry,
          runner: this.runner,
          deduplicator: this.deduplicator,
          repository: this.repository,
          severityThreshold: this.severityThreshold,
        },
        {
          scanId,
          repositoryUrl,
          repositoryName: prepared.profile.meta.name,
          localPath: prepared.localPath,
          target,
          startedAt,
        }
      );

      logger.info(
        { scanId, status: result.status, findings: result.findings.length, scanners: result.scannerStatistics.length, repositoryUrl },
        'scan.static:complete'
      );
      return result;
    } catch (error) {
      logger.error({ scanId, error, repositoryUrl }, 'scan.static:failed');
      if (scanId) {
        await this.repository
          .completeScan(scanId, { status: 'FAILED', completedAt: new Date(), scannerStats: [] })
          .catch(() => undefined);
      }
      throw error;
    } finally {
      await this.preparer.disposeRepository(prepared.localPath).catch(() => undefined);
    }
  }

  async getScanOverview(scanId: string): Promise<ScanOverview | null> {
    const result = await this.repository.getScanResults(scanId);
    if (!result) return null;
    return {
      scanId: result.scan.id,
      name: result.scan.name,
      status: result.scan.status,
      startedAt: result.scan.startedAt.toISOString(),
      completedAt: result.scan.completedAt?.toISOString() ?? null,
      repository: result.scan.repository
        ? { name: result.scan.repository.name, url: result.scan.repository.url }
        : null,
      summary: summarize(result.findings),
      scannerStatistics: result.scan.scannerStats,
    };
  }

  async getScanFindings(scanId: string): Promise<readonly StoredFinding[] | null> {
    const result = await this.repository.getScanResults(scanId);
    return result ? result.findings : null;
  }

  async getScanStatistics(
    scanId: string
  ): Promise<{ summary: ReturnType<typeof summarize>; scannerStatistics: readonly ScannerStatistics[] } | null> {
    const result = await this.repository.getScanResults(scanId);
    if (!result) return null;
    return {
      summary: summarize(result.findings),
      scannerStatistics: result.scan.scannerStats,
    };
  }
}
