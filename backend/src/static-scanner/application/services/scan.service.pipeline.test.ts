import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ScanService } from './scan.service';
import { MemoryScanRepository } from '../../../../test/helpers/scan-repository-memory';
import { createGitRepoFixture } from '../../../../test/helpers/git-repo';
import { DefaultScannerRegistry } from '../../infrastructure/scanning/registry/scanner-registry';
import { ScannerRunnerService } from '../../infrastructure/scanning/runner/scanner-runner';
import { KeyedFindingDeduplicator } from '../../infrastructure/scanning/deduplicator/deduplicator';
// Real analyzer pipeline (used as the RepositoryPreparer).
import { RepositoryProfileService } from '../../../repository-analysis/application/services/repository-profile.service';
import { RepositoryCloningService } from '../../../repository-analysis/application/services/repository-cloning.service';
import { GitRepositoryCloner } from '../../../repository-analysis/infrastructure/git/git-repository-cloner';
import { DefaultFileSystemAnalyzer } from '../../../repository-analysis/infrastructure/fs/file-system-analyzer';
import { SignatureTechnologyDetector } from '../../../repository-analysis/infrastructure/detection/technology-detector';
import { DefaultDependencyAnalyzer } from '../../../repository-analysis/infrastructure/dependency-analyzer';
import { SignatureArchitectureAnalyzer } from '../../../repository-analysis/infrastructure/analyzers/architecture-analyzer';
import { RegexApiAnalyzer } from '../../../repository-analysis/infrastructure/analyzers/api-analyzer';
import { RegexAuthenticationAnalyzer } from '../../../repository-analysis/infrastructure/analyzers/authentication-analyzer';
import type { RepositoryUrlResolver } from '../../../repository-analysis/domain/ports/repository-url-resolver';
import type { Scanner } from '../../domain/ports/scanner';
import type { ScanContext, ScannerRunResult } from '../../domain/models/scan';
import type { ScanTargetProfile } from '../../domain/models/scan-target';
import type { ScannerMetadata } from '../../domain/models/scanner-metadata';
import type { UnifiedFinding } from '../../domain/models/finding';

/** Scanner stub: applicable to everything, deterministic single finding. */
class AlwaysOnScanner implements Scanner {
  readonly id = 'stub';
  readonly engine = 'Stub';
  readonly metadata: ScannerMetadata = {
    id: 'stub',
    engine: 'Stub',
    kind: 'general',
    languages: [],
    description: 'test stub',
    networkAccess: false,
  };
  isApplicable(_profile: ScanTargetProfile): boolean {
    return true;
  }
  buildCommand() {
    return { argv: ['stub'], cwd: '/repo', timeoutMs: 1_000 };
  }
  parse() {
    return [];
  }
  normalize() {
    return [];
  }
  async run(_context: ScanContext): Promise<ScannerRunResult> {
    const finding: UnifiedFinding = {
      id: 'vuln_stub_1',
      scanner: this.id,
      type: 'STUB_ISSUE',
      severity: 'HIGH',
      confidence: 1,
      file: 'src/server.ts',
      line: 3,
      message: 'stub finding from the real pipeline',
      cwe: 'CWE-89',
      cve: null,
      references: ['https://example.com/stub'],
      evidence: 'stub',
      createdAt: new Date().toISOString(),
    };
    return {
      scannerId: this.id,
      engine: this.engine,
      status: 'completed',
      durationMs: 1,
      error: null,
      findings: [finding],
      rawItems: 1,
    };
  }
}

function fakeResolver(cloneUrl: string): RepositoryUrlResolver {
  return {
    parse: () => ({
      provider: 'github',
      owner: 'test',
      name: 'repo',
      cloneUrl,
      homepageUrl: 'https://github.com/test/repo',
      defaultBranch: 'main',
    }),
  };
}

function makeRealPreparer(workspaceDir: string, cloneUrl: string): RepositoryProfileService {
  return new RepositoryProfileService({
    cloning: new RepositoryCloningService({
      resolver: fakeResolver(cloneUrl),
      cloner: new GitRepositoryCloner({ timeoutMs: 30_000 }),
      workspaceDir,
      maxRepoBytes: 1_000_000_000,
    }),
    fileSystemAnalyzer: new DefaultFileSystemAnalyzer(),
    technologyDetector: new SignatureTechnologyDetector(),
    dependencyAnalyzer: new DefaultDependencyAnalyzer(),
    architectureAnalyzer: new SignatureArchitectureAnalyzer(),
    apiAnalyzer: new RegexApiAnalyzer(),
    authenticationAnalyzer: new RegexAuthenticationAnalyzer(),
    keepRepoDir: false,
  });
}

describe('GitHub → Analyzer → Static Scanner → UVM (full chain)', () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    for (const workspace of workspaces.splice(0)) {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('clones a real repo, analyzes it, scans it, and persists the UVM', async () => {
    const fixture = await createGitRepoFixture({
      'README.md': '# acme-api\n',
      'package.json': JSON.stringify({
        name: 'acme-api',
        version: '1.0.0',
        dependencies: { express: '4.19.2' },
      }),
      'src/server.ts': "import express from 'express';\nconst app = express();\napp.get('/health', (_req, res) => res.send('ok'));\n",
    });

    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-chain-'));
    workspaces.push(workspaceDir);

    try {
      const preparer = makeRealPreparer(workspaceDir, fixture.fileUrl);
      const repository = new MemoryScanRepository();
      const service = new ScanService({
        preparer,
        registry: new DefaultScannerRegistry([new AlwaysOnScanner()]),
        runner: new ScannerRunnerService(),
        deduplicator: new KeyedFindingDeduplicator(),
        repository,
        severityThreshold: 'INFO' as never,
      });

      const result = await service.runStaticScan('https://github.com/test/repo');

      // The analyzer really ran (profile carried into the scan result).
      expect(result.status).toBe('COMPLETED');
      expect(result.repository.name).toBe('repo');
      expect(result.repository.url).toBe('https://github.com/test/repo');
      expect(result.summary).toEqual({ total: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0 });

      // The UVM is persisted and retrievable.
      const findings = await service.getScanFindings(result.scanId);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ scanner: 'stub', type: 'STUB_ISSUE', severity: 'HIGH' });

      const overview = await service.getScanOverview(result.scanId);
      expect(overview?.repository?.url).toBe('https://github.com/test/repo');
      expect(overview?.scannerStatistics).toHaveLength(1);

      // The cloned working tree was cleaned up after the scan.
      const leftovers = await fs.readdir(workspaceDir);
      expect(leftovers).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });
});