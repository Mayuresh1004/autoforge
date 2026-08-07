import { describe, it, expect, vi } from 'vitest';
import type { RepositoryProfile } from '../../../repository-analysis/domain/models/repository-profile';
import type { RepositoryPreparer } from '../ports/repository-preparer';
import { ScanService } from './scan.service';
import { DefaultScannerRegistry } from '../../infrastructure/scanning/registry/scanner-registry';
import { ScannerRunnerService } from '../../infrastructure/scanning/runner/scanner-runner';
import { KeyedFindingDeduplicator } from '../../infrastructure/scanning/deduplicator/deduplicator';
import { MemoryScanRepository } from '../../../../test/helpers/scan-repository-memory';
import {
  SEMGREP_JSON,
  NPM_AUDIT_JSON,
  mockExecutor,
  okOutput,
  failOutput,
} from '../../../../test/helpers/scanner-fixtures';
import { BanditScanner } from '../../infrastructure/scanning/scanners/bandit/bandit-scanner';
import { PipAuditScanner } from '../../infrastructure/scanning/scanners/pip-audit/pip-audit-scanner';
import { SemgrepScanner } from '../../infrastructure/scanning/scanners/semgrep/semgrep-scanner';
import { NpmAuditScanner } from '../../infrastructure/scanning/scanners/npm-audit/npm-audit-scanner';

const URL = 'https://github.com/acme/demo';

function makeProfile(): RepositoryProfile {
  return {
    meta: {
      provider: 'github',
      owner: 'acme',
      name: 'demo',
      homepageUrl: URL,
      cloneUrl: URL,
      commitSha: null,
      sizeBytes: 100,
      clonedAt: new Date().toISOString(),
      analyzedAt: new Date().toISOString(),
    },
    fileSystem: {
      fileCount: 2,
      folderCount: 1,
      totalSizeBytes: 100,
      linesOfCode: 10,
      topExtensions: [['.ts', 1]],
      importantFiles: ['package.json', 'package-lock.json'],
    },
    technologies: {
      primary: null,
      all: [{ name: 'TypeScript', category: 'language', confidence: 0.9 }],
    },
    dependencies: [
      { ecosystem: 'npm', source: 'package.json', count: 1, runtimes: {}, librariesByCategory: {} },
    ],
    architecture: { primary: 'layered', candidates: [{ type: 'layered', confidence: 0.8 }] },
    api: { endpointCount: 0, protocols: [], graphqlSources: [], endpoints: [] },
    authentication: { schemes: [], libraries: [], middleware: [] },
  };
}

class FakePreparer implements RepositoryPreparer {
  readonly disposed: string[] = [];
  constructor(
    private readonly profile: RepositoryProfile,
    private readonly throwOnPrepare = false
  ) {}
  async prepareRepository(url: string): Promise<{ profile: RepositoryProfile; localPath: string }> {
    if (this.throwOnPrepare) throw new Error(`cannot clone ${url}`);
    return { profile: this.profile, localPath: '/repo' };
  }
  async disposeRepository(localPath: string): Promise<void> {
    this.disposed.push(localPath);
  }
}

function buildService(preparer: RepositoryPreparer, severityThreshold = 'INFO') {
  const registry = new DefaultScannerRegistry([
    new BanditScanner(mockExecutor({ bandit: () => failOutput() })),
    new PipAuditScanner(mockExecutor({ 'pip-audit': () => failOutput() })),
    new SemgrepScanner(
      mockExecutor({ semgrep: () => okOutput(SEMGREP_JSON) })
    ),
    new NpmAuditScanner(
      mockExecutor({ 'npm audit': () => okOutput(NPM_AUDIT_JSON, 1) })
    ),
  ]);
  const repository = new MemoryScanRepository();
  const service = new ScanService({
    preparer,
    registry,
    runner: new ScannerRunnerService(),
    deduplicator: new KeyedFindingDeduplicator(),
    repository,
    severityThreshold: severityThreshold as never,
  });
  return { service, repository };
}

describe('ScanService (static scan pipeline)', () => {
  it('runs a scan end-to-end: select → run → normalize → dedupe → persist → summarize', async () => {
    const preparer = new FakePreparer(makeProfile());
    const { service, repository } = buildService(preparer);

    const result = await service.runStaticScan(URL);

    expect(result.status).toBe('COMPLETED');
    expect(result.repository.name).toBe('demo');
    expect(result.summary).toEqual({ total: 3, critical: 1, high: 1, medium: 1, low: 0, info: 0 });
    expect(result.findings.map((f) => f.severity).sort()).toEqual(['CRITICAL', 'HIGH', 'MEDIUM']);
    expect(result.scannerStatistics.map((s) => s.scannerId)).toEqual(['semgrep', 'npm-audit']);

    // Persisted: scan + repository link + findings survive retrieval.
    const overview = await service.getScanOverview(result.scanId);
    expect(overview?.status).toBe('COMPLETED');
    expect(overview?.repository?.url).toBe(URL);
    expect(overview?.summary).toEqual(result.summary);

    const findings = await service.getScanFindings(result.scanId);
    expect(findings).toHaveLength(3);

    const statistics = await service.getScanStatistics(result.scanId);
    expect(statistics?.summary.total).toBe(3);
    expect(statistics?.scannerStatistics).toHaveLength(2);

    expect(preparer.disposed).toEqual(['/repo']);
    expect(repository.getScanCount()).toBe(1);
  });

  it('marks the scan FAILED when a scanner crashes but keeps the other findings', async () => {
    const preparer = new FakePreparer(makeProfile());
    const registry = new DefaultScannerRegistry([
      new SemgrepScanner(
        mockExecutor({ semgrep: () => okOutput('bad json') }) // parse failure
      ),
      new NpmAuditScanner(
        mockExecutor({ 'npm audit': () => okOutput(NPM_AUDIT_JSON, 1) })
      ),
    ]);
    const repository = new MemoryScanRepository();
    const service = new ScanService({
      preparer,
      registry,
      runner: new ScannerRunnerService(),
      deduplicator: new KeyedFindingDeduplicator(),
      repository,
      severityThreshold: 'INFO' as never,
    });

    const result = await service.runStaticScan(URL);

    expect(result.status).toBe('FAILED');
    expect(result.scannerStatistics.map((s) => [s.scannerId, s.status])).toEqual([
      ['semgrep', 'failed'],
      ['npm-audit', 'completed'],
    ]);
    expect(result.findings).toHaveLength(2); // npm audit findings still saved
    const persisted = await repository.getScanResults(result.scanId);
    expect(persisted?.findings).toHaveLength(2);
  });

  it('applies the severity threshold before persisting', async () => {
    const preparer = new FakePreparer(makeProfile());
    const { service } = buildService(preparer, 'HIGH');
    const result = await service.runStaticScan(URL);
    expect(result.findings.map((f) => f.severity).sort()).toEqual(['CRITICAL', 'HIGH']);
    expect(result.summary.medium).toBe(0);
  });

  it('propagates preparation errors and persists nothing', async () => {
    const preparer = new FakePreparer(makeProfile(), true);
    const { service, repository } = buildService(preparer);

    await expect(service.runStaticScan(URL)).rejects.toThrow('cannot clone');
    expect(repository.getScanCount()).toBe(0);
    expect(preparer.disposed).toEqual([]);
  });
});