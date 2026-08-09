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
import type { AmassEventPublisher, AmassEventInput } from '../../../observability/domain/ports/event-bus';
import { DeferredEventPublisher } from '../../../observability/application/deferred-publisher';

export interface ScanServiceOptions {
  readonly preparer: RepositoryPreparer;
  readonly registry: ScannerRegistry;
  readonly runner: ScannerRunnerPort;
  readonly deduplicator: FindingDeduplicator;
  readonly repository: ScanRepository;
  readonly severityThreshold: Severity;
  /** Phase 9 observability publisher (default: silent). */
  readonly events?: AmassEventPublisher;
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
  private readonly events: AmassEventPublisher | undefined;

  constructor(options: ScanServiceOptions) {
    this.preparer = options.preparer;
    this.registry = options.registry;
    this.runner = options.runner;
    this.deduplicator = options.deduplicator;
    this.repository = options.repository;
    this.severityThreshold = options.severityThreshold;
    this.events = options.events;
  }

  async runStaticScan(repositoryUrl: string): Promise<ScanResult> {
    logger.info({ repositoryUrl }, 'scan.static:started');

    const deferred = new DeferredEventPublisher(this.events);
    deferred.emit({ eventType: 'ANALYZER_STARTED', agentType: 'ANALYZER', phase: 'analysis', status: 'STARTED', message: 'cloning and analyzing the repository', metadata: { targetUrl: repositoryUrl } });

    const prepared = await this.preparer.prepareRepository(repositoryUrl);
    deferred.emit({ eventType: 'ANALYZER_COMPLETED', agentType: 'ANALYZER', phase: 'analysis', status: 'COMPLETED', message: 'repository analysis finished', metadata: { counts: { technologies: prepared.profile.technologies.all.length } } });
    let scanId: string | undefined;

    try {
      const target = toScanTargetProfile(prepared.profile);
      const store = await this.repository.createScan({
        name: prepared.profile.meta.name,
        repositoryUrl,
      });
      scanId = store.id;
      this.emit(scanId, { eventType: 'SCAN_STARTED', agentType: 'SYSTEM', phase: 'scan', status: 'STARTED', message: `scan ${scanId} started`, metadata: { targetUrl: repositoryUrl } });
      deferred.flush(scanId);
      const startedAt = new Date();
      await this.repository.markScanRunning(scanId, startedAt);

      this.emit(scanId, { eventType: 'SCANNER_STARTED', agentType: 'SCANNER', phase: 'scanning', status: 'STARTED', message: 'running the selected scanners', metadata: {} });
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

      this.emit(scanId, { eventType: 'SCANNER_COMPLETED', agentType: 'SCANNER', phase: 'scanning', status: 'COMPLETED', message: `scanners finished with ${result.findings.length} findings`, metadata: { counts: { findings: result.findings.length, scanners: result.scannerStatistics.length } } });
      this.emit(scanId, { eventType: 'SCAN_COMPLETED', agentType: 'SYSTEM', phase: 'scan', status: 'COMPLETED', message: `scan ${scanId} completed`, metadata: { counts: { findings: result.findings.length } } });
      logger.info(
        { scanId, status: result.status, findings: result.findings.length, scanners: result.scannerStatistics.length, repositoryUrl },
        'scan.static:complete'
      );
      return result;
    } catch (error) {
      logger.error({ scanId, error, repositoryUrl }, 'scan.static:failed');
      if (scanId) {
        this.emit(scanId, { eventType: 'SCAN_FAILED', agentType: 'SYSTEM', phase: 'scan', level: 'ERROR', status: 'FAILED', message: 'scan failed', metadata: { error: error instanceof Error ? error.message.slice(0, 160) : undefined } });
        await this.repository
          .completeScan(scanId, { status: 'FAILED', completedAt: new Date(), scannerStats: [] })
          .catch(() => undefined);
      } else {
        deferred.discard();
      }
      throw error;
    } finally {
      await this.preparer.disposeRepository(prepared.localPath).catch(() => undefined);
    }
  }

  private emit(scanId: string, input: Omit<AmassEventInput, 'scanId'>): void {
    if (!this.events) return;
    try {
      this.events.publish({ ...input, scanId });
    } catch (error) {
      logger.warn({ err: error }, 'scan.static: publish ignored');
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
