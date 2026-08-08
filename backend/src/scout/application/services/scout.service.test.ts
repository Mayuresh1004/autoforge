import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startScoutTestServer } from '../../../../test/helpers/scout-test-app';
import { MemoryScoutRepository } from '../../../../test/helpers/scout-repository-memory';
import { scoutConfig } from '../../../config';
import { ScoutScanNotFoundError } from '../../domain/errors/scout.errors';
import type { ScoutServiceDeps } from './scout.service';
import { DefaultScoutService } from './scout.service';
import { DirectToolRuntime } from '../../infrastructure/tools/direct-tool-runtime';
import { HttpCrawler } from '../../infrastructure/tools/http-crawler';
import { RobotsTxtParser } from '../../infrastructure/tools/robots-txt-parser';
import { SignatureTechnologyFingerprinter } from '../../infrastructure/tools/signature-technology-fingerprinter';
import { ScoutEndpointDiscoverer } from '../../infrastructure/tools/endpoint-discoverer';
import { HeuristicAttackSurfacePrioritizer } from './attack-surface-prioritizer';
import { ScoutRecon } from './scout-recon';
import type { PortScanner } from '../../domain/ports/port-scanner';

describe('DefaultScoutService (full recon run)', () => {
  let origin: string;
  let close: () => Promise<void>;
  const repository = new MemoryScoutRepository();

  const failingPortScanner: PortScanner = {
    scan: async () => {
      throw new Error('nmap exploded');
    },
  };

  function buildService(repo = repository, portScanner: PortScanner = failingPortScanner) {
    const runtime = new DirectToolRuntime();
    const reconDeps = {
      runtime,
      crawler: new HttpCrawler(runtime),
      robotsParser: new RobotsTxtParser(),
      fingerprinter: new SignatureTechnologyFingerprinter(),
      portScanner,
      endpointDiscoverer: new ScoutEndpointDiscoverer(runtime),
      prioritizer: new HeuristicAttackSurfacePrioritizer(),
    };
    const deps: Omit<ScoutServiceDeps, 'config'> & { config: typeof scoutConfig } = {
      repository: repo,
      config: scoutConfig,
      recon: new ScoutRecon(reconDeps),
    };
    return new DefaultScoutService(deps);
  }

  beforeAll(async () => {
    const server = await startScoutTestServer();
    origin = server.origin;
    close = server.close;
    repository.setContext({
      scanId: 'scan-1',
      scanStatus: 'COMPLETED',
      repositoryName: 'demo/app',
      repositoryUrl: 'https://github.com/demo/app',
      staticFindings: 3,
    });
    repository.setContext({ scanId: 'scan-2', scanStatus: 'COMPLETED', repositoryName: 'x', repositoryUrl: 'y', staticFindings: 0 });
  });

  afterAll(async () => {
    await close();
  });

  it('produces a complete attack-surface report against a live app', async () => {
    const service = buildService();
    const report = await service.run({
      scanId: 'scan-1',
      targetUrl: origin,
      options: { maxPages: 30, maxDepth: 2, timeoutMs: 30_000, portScan: true },
    });

    expect(report.status).toBe('COMPLETED');
    expect(report.health.reachable).toBe(true);
    expect(report.scanId).toBe('scan-1');
    expect(report.scoutScanId).toMatch(/^scout-/);

    // Summary reflects what recon found.
    expect(report.summary.endpoints).toBeGreaterThan(0);
    expect(report.summary.forms).toBeGreaterThanOrEqual(1);
    expect(report.summary.graphql).toBe(true);
    expect(report.summary.websockets).toBeGreaterThanOrEqual(1);

    // Key attack-surface entries with heuristic risk.
    const admin = report.attackSurface.find((e) => e.url.includes('/admin/users'));
    expect(admin?.authentication).toBe(true);
    expect(admin?.risk).toBe('HIGH');

    const search = report.attackSurface.find((e) => e.url.includes('/api/search'));
    expect(search?.method).toBe('POST');
    expect(search?.parameters).toContain('query');
    expect(search?.risk).toBe('MEDIUM');

    // Technologies fingerprinted from the live app (Express sets x-powered-by).
    expect(report.technologies.some((t) => t.name === 'Express')).toBe(true);

    // Tool failure was isolated: recon still completed and logged the error.
    expect(report.status).toBe('COMPLETED');
    expect(report.errors.some((e) => e.includes('portscan'))).toBe(true);

    // Persisted + readable.
    const stored = await service.getScoutScan(report.scoutScanId);
    expect(stored?.scoutScan.status).toBe('COMPLETED');
    expect(stored?.attackSurface.length).toBe(report.attackSurface.length);
  });

  it('supports concurrent runs on separate scans', async () => {
    const repo = new MemoryScoutRepository();
    repo.setContext({ scanId: 'scan-a', scanStatus: 'COMPLETED', repositoryName: 'a', repositoryUrl: 'a', staticFindings: 0 });
    repo.setContext({ scanId: 'scan-b', scanStatus: 'COMPLETED', repositoryName: 'b', repositoryUrl: 'b', staticFindings: 0 });
    const service = buildService(repo);

    const [ra, rb] = await Promise.all([
      service.run({ scanId: 'scan-a', targetUrl: origin, options: { maxPages: 10, maxDepth: 1 } }),
      service.run({ scanId: 'scan-b', targetUrl: origin, options: { maxPages: 10, maxDepth: 1 } }),
    ]);
    expect(ra.scanId).toBe('scan-a');
    expect(rb.scanId).toBe('scan-b');
    expect(repo.getScanCount()).toBe(2);
    expect(ra.status).toBe('COMPLETED');
    expect(rb.status).toBe('COMPLETED');
  });

  it('throws when the source scan does not exist', async () => {
    const service = buildService(new MemoryScoutRepository());
    await expect(
      service.run({ scanId: 'missing', targetUrl: origin }),
    ).rejects.toBeInstanceOf(ScoutScanNotFoundError);
  });

  it('rejects an unreachable target with a completed (empty) report, not a crash', async () => {
    const service = buildService();
    const report = await service.run({
      scanId: 'scan-1',
      targetUrl: 'http://127.0.0.1:1',
      options: { maxPages: 5, maxDepth: 1, portScan: false },
    });
    expect(report.status).toBe('COMPLETED');
    expect(report.health.reachable).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });
});