import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { CreateSandboxInput, SandboxManager, SandboxHealth } from '../../domain/ports/sandbox-manager';
import type { ExecRequest, ExecResult, Sandbox, SandboxPatch } from '../../domain/models/sandbox';
import type { Severity } from '../../../static-scanner/domain/models/severity';
import type { ScannerExecutor } from '../../../static-scanner/domain/ports/scanner-executor';
import type { Scanner } from '../../../static-scanner/domain/ports/scanner';
import type { ScanContext, ScannerRunResult } from '../../../static-scanner/domain/models/scan';
import type { ScanTargetProfile } from '../../../static-scanner/domain/models/scan-target';
import type { ScannerMetadata } from '../../../static-scanner/domain/models/scanner-metadata';
import type { UnifiedFinding } from '../../../static-scanner/domain/models/finding';
import { DefaultScannerRegistry } from '../../../static-scanner/infrastructure/scanning/registry/scanner-registry';
import { createGitRepoFixture } from '../../../../test/helpers/git-repo';
import { MemoryScanRepository } from '../../../../test/helpers/scan-repository-memory';
import { ProcessSandboxBackend } from '../../infrastructure/process-sandbox-backend';
import { MemorySandboxStore } from '../../infrastructure/store/memory-sandbox-store';
import { SandboxManagerService } from './sandbox-manager.service';
import { ScannerRunnerService } from '../../../static-scanner/infrastructure/scanning/runner/scanner-runner';
import { KeyedFindingDeduplicator } from '../../../static-scanner/infrastructure/scanning/deduplicator/deduplicator';
import { createRepositoryTargetAnalyzer } from '../../../static-scanner/application/services/repository-target-analyzer';
import { SandboxedScanOrchestrator } from './sandboxed-scan-orchestrator';

describe('SandboxedScanOrchestrator (whole clone→analyze→scan through the manager)', () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('clones, analyzes and scans inside a manager sandbox, then destroys it', async () => {
    const fixture = await createGitRepoFixture({
      'README.md': '# acme\n',
      'package.json': JSON.stringify({
        name: 'acme',
        version: '1.0.0',
        dependencies: { lodash: '4.19.2' },
      }),
    });

    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-sandboxed-'));
    roots.push(workspaceRoot);

    const manager: SandboxManager = new SandboxManagerService({
      backend: new ProcessSandboxBackend({ workspaceRoot }),
      store: new MemorySandboxStore(),
      createTimeoutMs: 60_000,
      defaultExecTimeoutMs: 30_000,
    });
    const counting = new CountingSandboxManager(manager);

    const orchestrator = new SandboxedScanOrchestrator({
      manager: counting,
      analyzeTarget: createRepositoryTargetAnalyzer(),
      // Deterministic scanner suite: proves scanner commands execute inside
      // the sandbox (a real `git rev-parse` of the freshly cloned tree).
      registryFactory: (executor: ScannerExecutor) =>
        new DefaultScannerRegistry([new SandboxProbeScanner(executor)]),
      runner: new ScannerRunnerService(),
      deduplicator: new KeyedFindingDeduplicator(),
      repository: new MemoryScanRepository(),
      severityThreshold: 'INFO' as Severity,
      image: 'amass/analysis:test',
      cloneTimeoutMs: 30_000,
    });

    const result = await orchestrator.runScan(fixture.fileUrl);

    expect(result.status).toBe('COMPLETED');
    expect(result.summary).toEqual({ total: 1, critical: 0, high: 0, medium: 0, low: 0, info: 1 });
    expect(counting.executes).toBeGreaterThanOrEqual(2); // clone + scanner exec, both via manager
    expect(counting.destroys).toBeGreaterThanOrEqual(1); // sandbox torn down

    // The sandbox workspace was removed (no leftover tree).
    const leftovers = await fs.readdir(workspaceRoot);
    expect(leftovers).toHaveLength(0);
  });
});

/**
 * Delegates to a real manager but tallies the manager surface calls — proves
 * the pipeline reached the manager (the single gatekeeper) and ran there.
 */
class CountingSandboxManager implements SandboxManager {
  private readonly inner: SandboxManager;
  executes = 0;
  destroys = 0;
  constructor(inner: SandboxManager) {
    this.inner = inner;
  }
  async createSandbox(input: CreateSandboxInput): Promise<Sandbox> {
    return this.inner.createSandbox(input);
  }
  async waitUntilReady(id: string, timeoutMs?: number): Promise<Sandbox> {
    return this.inner.waitUntilReady(id, timeoutMs);
  }
  async getSandbox(id: string): Promise<Sandbox | null> {
    return this.inner.getSandbox(id);
  }
  async healthCheck(id: string, timeoutMs?: number): Promise<SandboxHealth> {
    return this.inner.healthCheck(id, timeoutMs);
  }
  async execute(id: string, request: ExecRequest): Promise<ExecResult> {
    this.executes += 1;
    return this.inner.execute(id, request);
  }
  async copyFile(id: string, src: string, dest: string): Promise<void> {
    return this.inner.copyFile(id, src, dest);
  }
  async applyPatch(id: string, patches: readonly SandboxPatch[]): Promise<Sandbox> {
    return this.inner.applyPatch(id, patches);
  }
  async restart(id: string): Promise<Sandbox> {
    return this.inner.restart(id);
  }
  async *collectLogs(id: string): AsyncIterable<string> {
    yield* this.inner.collectLogs(id);
  }
  async destroy(id: string): Promise<void> {
    this.destroys += 1;
    return this.inner.destroy(id);
  }
  async sweepOrphans(): Promise<number> {
    return this.inner.sweepOrphans();
  }
}

/**
 * Scanner stub that really executes inside the sandbox: it runs
 * `git rev-parse --short HEAD` in the scan context's working tree (the
 * freshly manager-cloned repo) and reports a finding when it succeeds.
 */
class SandboxProbeScanner implements Scanner {
  readonly id = 'sandbox-probe';
  readonly engine = 'Probe';
  readonly metadata: ScannerMetadata = {
    id: 'sandbox-probe',
    engine: 'Probe',
    kind: 'general',
    languages: [],
    description: 'proves scanner exec runs inside the manager sandbox',
    networkAccess: false,
  };

  constructor(private readonly executor: ScannerExecutor) {}

  isApplicable(_profile: ScanTargetProfile): boolean {
    return true;
  }

  buildCommand(context: ScanContext) {
    return { argv: ['git', 'rev-parse', '--short', 'HEAD'], cwd: context.localPath, timeoutMs: 10_000, network: false };
  }

  parse(output: { stdout: string }): readonly { severity: string; message: string }[] {
    const sha = output.stdout.trim();
    return sha ? [{ severity: 'INFO', message: `clone-head:${sha}` }] : [];
  }

  normalize(findings: readonly { severity: string; message: string }[], context: ScanContext): readonly UnifiedFinding[] {
    return findings.map((finding, index) => ({
      id: `vuln_probe_${index}`,
      scanner: this.id,
      type: 'SANDBOX_PROBE',
      severity: finding.severity as UnifiedFinding['severity'],
      confidence: 1,
      file: 'HEAD',
      line: 0,
      message: finding.message,
      cwe: null,
      cve: null,
      references: [],
      evidence: finding.message,
      createdAt: new Date().toISOString(),
    }));
  }

  async run(context: ScanContext, config: { timeoutMs: number }): Promise<ScannerRunResult> {
    try {
      const output = await this.executor.execute(this.buildCommand(context, config));
      const findings = this.normalize(this.parse(output), context);
      return {
        scannerId: this.id,
        engine: this.engine,
        status: 'completed',
        durationMs: 1,
        error: null,
        findings,
        rawItems: findings.length,
      };
    } catch (error) {
      return {
        scannerId: this.id,
        engine: this.engine,
        status: 'failed',
        durationMs: 1,
        error: error instanceof Error ? error.message : 'probe failed',
        findings: [],
        rawItems: 0,
      };
    }
  }
}