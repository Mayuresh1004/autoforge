import { logger } from '../../../config/logger';
import type { RepositoryProfile } from '../../../repository-analysis/domain/models/repository-profile';
import type { ScanTargetProfile } from '../../domain/models/scan-target';
import type { Severity } from '../../domain/models/severity';
import type {
  ScanContext,
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

      const context: ScanContext = {
        scanId,
        repositoryUrl,
        repositoryName: prepared.profile.meta.name,
        localPath: prepared.localPath,
        severityThreshold: this.severityThreshold,
      };

      const scanners = this.registry.select(target);
      const runs = await this.runner.runAll(scanners, context);
      const findings = this.deduplicator.deduplicate(runs.flatMap((run) => run.findings));

      const repository = await this.repository.upsertRepository({
        url: repositoryUrl,
        name: prepared.profile.meta.name,
        branch: 'main',
      });
      await this.repository.linkScanRepository(scanId, repository.id);
      await this.repository.saveFindings(scanId, findings);

      const scannerStatistics: ScannerStatistics[] = runs.map((run) => ({
        scannerId: run.scannerId,
        engine: run.engine,
        status: run.status,
        durationMs: run.durationMs,
        findings: run.findings.length,
      }));
      const hadFailures = runs.some((run) => run.status === 'failed');
      const status = hadFailures ? 'FAILED' : 'COMPLETED';
      const completedAt = new Date();
      await this.repository.completeScan(scanId, {
        status,
        completedAt,
        scannerStats: scannerStatistics,
      });

      const result: ScanResult = {
        scanId,
        repository: { name: prepared.profile.meta.name, url: repositoryUrl },
        status,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        summary: summarize(findings),
        scannerStatistics,
        findings,
      };

      logger.info(
        { scanId, status, findings: findings.length, scanners: runs.length, repositoryUrl },
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

function toScanTargetProfile(profile: RepositoryProfile): ScanTargetProfile {
  const importantFiles = profile.fileSystem.importantFiles;
  return {
    languages: profile.technologies.all
      .filter((tech) => tech.category === 'language')
      .map((tech) => tech.name),
    ecosystems: profile.dependencies.map((summary) => summary.ecosystem.toLowerCase()),
    dependencySources: profile.dependencies.map((summary) => summary.source),
    lockfiles: importantFiles.filter((file) =>
      /(package-lock|pnpm-lock|yarn\.lock|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock)/i.test(
        file
      )
    ),
    importantFiles,
  };
}