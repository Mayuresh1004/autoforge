import type { RepositoryProfile } from '../../../repository-analysis/domain/models/repository-profile';
import type { ScanContext, ScanResult, ScanStatus, ScannerStatistics } from '../../domain/models/scan';
import type { ScanTargetProfile } from '../../domain/models/scan-target';
import { summarize } from '../../domain/models/scan';
import type { Severity } from '../../domain/models/severity';
import type { ScannerRegistry } from '../../domain/ports/scanner-registry';
import type { ScannerRunnerPort } from '../../domain/ports/scanner-runner';
import type { FindingDeduplicator } from '../../domain/ports/deduplicator';
import type { ScanRepository } from '../../domain/ports/scan-repository';

/** Ports the shared scanner flow needs, regardless of how the repo was staged. */
export interface ScannerFlowDeps {
  readonly registry: ScannerRegistry;
  readonly runner: ScannerRunnerPort;
  readonly deduplicator: FindingDeduplicator;
  readonly repository: ScanRepository;
  readonly severityThreshold: Severity;
}

export interface ScannerFlowInput {
  readonly scanId: string;
  readonly repositoryUrl: string;
  readonly repositoryName: string;
  /** Absolute working-tree path scanners run against. */
  readonly localPath: string;
  /** Pre-computed scanner selection profile (kept small on purpose). */
  readonly target: ScanTargetProfile;
  readonly startedAt: Date;
}

/**
 * The deterministic tail shared by every scan path: select scanners → run
 * (isolated failures) → normalize → deduplicate → persist → summarize. Both
 * the classic `ScanService` (preparer-cloned) and the sandboxed orchestrator
 * (manager-cloned inside a sandbox) land here, so there is one code path.
 * Never makes security decisions.
 */
export async function runScannerFlow(
  deps: ScannerFlowDeps,
  input: ScannerFlowInput
): Promise<ScanResult> {
  const context: ScanContext = {
    scanId: input.scanId,
    repositoryUrl: input.repositoryUrl,
    repositoryName: input.repositoryName,
    localPath: input.localPath,
    severityThreshold: deps.severityThreshold,
  };

  const scanners = deps.registry.select(input.target);
  const runs = await deps.runner.runAll(scanners, context);
  const findings = deps.deduplicator.deduplicate(runs.flatMap((run) => run.findings));

  const repository = await deps.repository.upsertRepository({
    url: input.repositoryUrl,
    name: input.repositoryName,
    branch: 'main',
  });
  await deps.repository.linkScanRepository(input.scanId, repository.id);
  await deps.repository.saveFindings(input.scanId, findings);

  const scannerStatistics: ScannerStatistics[] = runs.map((run) => ({
    scannerId: run.scannerId,
    engine: run.engine,
    status: run.status,
    durationMs: run.durationMs,
    findings: run.findings.length,
  }));
  const hadFailures = runs.some((run) => run.status === 'failed');
  const status: Exclude<ScanStatus, 'PENDING'> = hadFailures ? 'FAILED' : 'COMPLETED';
  const completedAt = new Date();
  await deps.repository.completeScan(input.scanId, {
    status,
    completedAt,
    scannerStats: scannerStatistics,
  });

  return {
    scanId: input.scanId,
    repository: { name: input.repositoryName, url: input.repositoryUrl },
    status,
    startedAt: input.startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    summary: summarize(findings),
    scannerStatistics,
    findings,
  };
}

/** Maps a full RepositoryProfile to the small scanner-selection profile. */
export function toScanTargetProfile(profile: RepositoryProfile): ScanTargetProfile {
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