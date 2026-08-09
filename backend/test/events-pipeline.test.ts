/**
 * Phase 9 acceptance — ONE event stream across the WHOLE autonomous
 * pipeline, in production order:
 *
 *   Scan → (Sandbox) → Scout → Sniper → Engineer → Critic
 *
 * Real services, real composition seams, NO Docker/Postgres/network:
 * the manager is programmable, the scan scanner is faked at the executor
 * boundary, recon is a canned stub, the LLM is a programmed stub, the
 * critic endpoint is a fixture project on disk. Events flow through the
 * real InMemoryEventBus.
 *
 * Assertions:
 *  - the stream is coherent (every event belongs to the same scanId),
 *  - SCAN_STARTED is the FIRST event (sequence 1) — analysis events are
 *    flushed in order right behind it,
 *  - sequences are strictly monotonic (ordering never relies on
 *    timestamps),
 *  - the expected agent transitions appear IN ORDER (analyzer → scanner →
 *    sandbox → scout → sniper → engineer → critic → verdicts),
 *  - terminal verdicts (SNIPER_CONFIRMED, ENGINEER_PATCH_GENERATED,
 *    CRITIC_APPROVED) are all present.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { ExecResult, Sandbox, SandboxPatch } from '../src/sandbox/domain/models/sandbox';
import { InMemoryEventBus } from '../src/observability/application/in-memory-event-bus';
import type { AmassEvent, AmassEventType } from '../src/observability/domain/events/amass-event';
import { createApplicationInfrastructure } from '../src/application/application-root';
import { createRuntimeSandboxInfrastructure } from '../src/sandbox/infrastructure/factory/runtime-sandbox-factory';
import type { RuntimeSandboxService } from '../src/sandbox/domain/ports/runtime-sandbox-service';
import type { RuntimeWorkspaceProvider } from '../src/sandbox/domain/ports/runtime-workspace-provider';
import { FileSystemPromptRegistry, resolvePromptsRoot } from '../src/prompts/infrastructure/fs-prompt-registry';
import { DefaultAgentExecutionService } from '../src/agent/application/services/agent-execution.service';
import { MemoryAgentExecutionRepository } from './helpers/memory-agent-execution-repository';
import { ScanService } from '../src/static-scanner/application/services/scan.service';
import { DefaultScannerRegistry } from '../src/static-scanner/infrastructure/scanning/registry/scanner-registry';
import { BanditScanner } from '../src/static-scanner/infrastructure/scanning/scanners/bandit/bandit-scanner';
import { ScannerRunnerService } from '../src/static-scanner/infrastructure/scanning/runner/scanner-runner';
import { KeyedFindingDeduplicator } from '../src/static-scanner/infrastructure/scanning/deduplicator/deduplicator';
import { mockExecutor, BANDIT_JSON } from './helpers/scanner-fixtures';
import { MemoryScanRepository } from './helpers/scan-repository-memory';
import type { RepositoryPreparer } from '../src/static-scanner/application/ports/repository-preparer';
import type { RepositoryProfile } from '../src/repository-analysis/domain/models/repository-profile';
import { DefaultScoutService } from '../src/scout/application/services/scout.service';
import { MemoryScoutRepository } from './helpers/scout-repository-memory';
import { ScoutRecon, type ScoutReconDeps } from '../src/scout/application/services/scout-recon';
import type { AttackSurfaceEntry } from '../src/scout/domain/models/attack-surface';
import type { DiscoveryResult } from '../src/scout/domain/ports/endpoint-discoverer';
import type { HttpProbeResult } from '../src/scout/domain/ports/scout-tool-runtime';
import { createSniperInfrastructure } from '../src/sniper/infrastructure/factory/sniper-factory';
import { MemorySniperRepository } from './helpers/sniper-repository-memory';
import { SQLMAP_VULNERABLE, SQLMAP_NOT_INJECTABLE } from './helpers/sniper-fixtures';
import { MemoryRuntimeSandboxStore } from './helpers/memory-runtime-sandbox-store';
import { MemoryRuntimeSandboxRegistry } from '../src/sandbox/infrastructure/registry/memory-runtime-registry';
import { FakeHealthProber, FakeScanGateway, FakeWorkspaceProvider } from './helpers/runtime-test-fakes';
import { runtimeSandboxConfig, scoutConfig } from '../src/config';
import { DefaultEngineerService } from '../src/engineer/application/services/engineer.service';
import { ManagerSourceReader } from '../src/engineer/infrastructure/source/manager-source-reader';
import { DEFAULT_ENGINEER_BOUNDS } from '../src/engineer/domain/models/engineer-response';
import {
  confirmedFinding,
  MemoryConfirmedFindingRepository,
  MemoryEngineerPatchRepository,
  ProgrammedLLMProvider,
  StubRagService,
  SQLI_PATCH_JSON,
} from './helpers/engineer-fakes';
import { CriticSteps } from '../src/critic/application/services/critic-steps';
import { CriticOutcomeWriter } from '../src/critic/application/services/critic-outcome';
import { DefaultCriticService } from '../src/critic/application/services/critic.service';
import { SandboxPatchApplier } from '../src/critic/application/services/patch-applier';
import { CriticBuildCheck } from '../src/critic/application/services/build-check';
import { CriticRegressionTestRunner } from '../src/critic/application/services/test-runner';
import { CriticSecurityReviewGate } from '../src/critic/application/services/security-review-gate';
import { CriticAdvisoryReviewer } from '../src/critic/application/services/llm-review';
import {
  MemoryCriticRepository,
  MemoryCriticEventSink,
  MemoryPatchReviewRepository,
  StubCriticFindingResolver,
  criticPatch,
  criticContext,
  CRITIC_BASE_SOURCE,
} from './helpers/critic-fakes';
import { ProgrammedSandboxManager } from './helpers/programmed-sandbox-manager';

const SCAN_ID = 'scan-pipe';
const PROMPT_REGISTRY = new FileSystemPromptRegistry(resolvePromptsRoot(process.env.PROMPTS_ROOT));

/** Same programmable manager shape as the composition acceptance suite. */
class PipelineSandboxManager extends ProgrammedSandboxManager {
  private readonly sqlmapRuns = new Map<string, number>();
  private readonly sandboxEpochs = new Map<string, number>();
  execQueue: ExecResult[] = [];

  override async execute(
    sandboxId: string,
    request: { argv: readonly string[]; timeoutMs?: number }
  ): Promise<ExecResult> {
    this.execCalls.push({ sandboxId, request });
    if (request.argv[0] === 'sqlmap') {
      const key = `${sandboxId}#${this.sandboxEpochs.get(sandboxId) ?? 0}`;
      const runs = (this.sqlmapRuns.get(key) ?? 0) + 1;
      this.sqlmapRuns.set(key, runs);
      return {
        stdout: runs === 1 ? SQLMAP_VULNERABLE : SQLMAP_NOT_INJECTABLE,
        stderr: '',
        exitCode: 0,
        timedOut: false,
      };
    }
    const next = this.execQueue.shift();
    return next ?? { stdout: '', stderr: '', exitCode: 0, timedOut: false };
  }

  override async createSandbox(input: Parameters<ProgrammedSandboxManager['createSandbox']>[0]): Promise<Sandbox> {
    const sandbox = await super.createSandbox(input);
    this.sandboxEpochs.set(sandbox.id, (this.sandboxEpochs.get(sandbox.id) ?? 0) + 1);
    return sandbox;
  }

  override async applyPatch(id: string, patches: readonly SandboxPatch[]): Promise<Sandbox> {
    const sandbox = this.sandboxes.get(id);
    if (!sandbox) throw new Error(`sandbox ${id} not found`);
    return sandbox;
  }
}

/** Canned recon — keeps the headless network out of the test. */
class StubRecon extends ScoutRecon {
  constructor() {
    super({} as unknown as ScoutReconDeps);
  }
  override async probe(url: string): Promise<HttpProbeResult> {
    return {
      url,
      finalUrl: url,
      ok: true,
      statusCode: 200,
      headers: {},
      body: '<html><body>demo</body></html>',
      bodyBytes: 27,
      latencyMs: 1,
      error: null,
    };
  }
  override async crawl(): Promise<readonly unknown[]> {
    return [];
  }
  override async robots(): Promise<unknown> {
    return {};
  }
  override async fingerprint(): Promise<readonly unknown[]> {
    return [];
  }
  override async scanPorts(): Promise<{ ports: readonly unknown[]; services: readonly unknown[] }> {
    return { ports: [], services: [] };
  }
  override async discover(): Promise<DiscoveryResult> {
    return { endpoints: [], forms: [], graphql: false, websockets: [] };
  }
  override prioritize(_endpoints: readonly unknown[], _technologies: readonly unknown[]): readonly AttackSurfaceEntry[] {
    return [
      {
        id: 'ep-1',
        url: 'http://sandbox.local/api/search',
        method: 'GET',
        parameters: ['q'],
        authentication: false,
        technology: [],
        risk: 'HIGH',
        source: 'discovery',
        reachable: true,
        statusCode: 200,
      },
    ];
  }
}

/** Minimal python profile so Bandit is selected by the scanner registry. */
function pythonProfile(): RepositoryProfile {
  return {
    meta: {
      name: 'demo-app',
      defaultBranch: 'main',
      primaryLanguage: null,
      license: null,
      description: null,
      stars: 0,
      forks: 0,
      openIssues: 0,
      cloneUrl: 'https://example.invalid/demo.git',
      commitSha: null,
      sizeBytes: 100,
      clonedAt: new Date().toISOString(),
      analyzedAt: new Date().toISOString(),
    },
    fileSystem: {
      fileCount: 1,
      folderCount: 1,
      totalSizeBytes: 100,
      linesOfCode: 10,
      topExtensions: [['.py', 1]],
      importantFiles: ['src/app.py'],
    },
    technologies: {
      primary: null,
      all: [{ name: 'Python', category: 'language', confidence: 0.9 }],
    },
    dependencies: [{ ecosystem: 'pip', source: 'pyproject.toml', count: 1, runtimes: {}, librariesByCategory: {} }],
    architecture: { primary: 'layered', candidates: [{ type: 'layered', confidence: 0.8 }] },
    api: { endpointCount: 0, protocols: [], graphqlSources: [], endpoints: [] },
    authentication: { schemes: [], libraries: [], middleware: [] },
  };
}

function isSubsequence(needle: readonly string[], haystack: readonly string[]): boolean {
  let i = 0;
  for (const type of haystack) {
    if (i < needle.length && type === needle[i]) i += 1;
  }
  return i === needle.length;
}

describe('Phase 9 — full pipeline event stream (Scan → Sandbox → Scout → Sniper → Engineer → Critic)', () => {
  let repoDir: string;
  let fakeDb = {} as unknown as PrismaClient;

  beforeAll(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-events-'));
    await fs.mkdir(path.join(repoDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(repoDir, 'src', 'app.py'), CRITIC_BASE_SOURCE, 'utf8');
    // Root-level entrypoint so the deterministic runtime resolver picks the
    // PYTHON strategy (Mode 2 template) — mirrors the composition fixture.
    await fs.writeFile(path.join(repoDir, 'app.py'), CRITIC_BASE_SOURCE, 'utf8');
  });

  afterAll(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it('emits one coherent, monotonic event stream across every pipeline stage', async () => {
    const bus = new InMemoryEventBus();
    const events: AmassEvent[] = [];
    bus.subscribe(SCAN_ID, (event) => events.push(event));

    const manager = new PipelineSandboxManager();
    const store = new MemoryRuntimeSandboxStore();
    const registry = new MemoryRuntimeSandboxRegistry();
    const prober = new FakeHealthProber();
    const gateway = new FakeScanGateway({ missingScan: undefined, relations: {} });
    const workspace = new FakeWorkspaceProvider();

    const root = createApplicationInfrastructure({
      db: fakeDb,
      manager,
      runtime: {
        store,
        registry,
        prober,
        gateway,
        workspace,
        config: { ...runtimeSandboxConfig, allowHostExpose: true },
      },
      rag: new StubRagService([]),
      llm: null,
      executions: new DefaultAgentExecutionService(new MemoryAgentExecutionRepository()),
      events: { bus },
    });

    // ---------------------------------------------------------------- 1. SCAN
    const preparer: RepositoryPreparer = {
      prepareRepository: async () => ({ profile: pythonProfile(), localPath: '/repo' }),
      disposeRepository: async () => undefined,
    };
    const scanService = new ScanService({
      preparer,
      registry: new DefaultScannerRegistry([
        new BanditScanner(mockExecutor({ bandit: () => ({ stdout: BANDIT_JSON, stderr: '', exitCode: 0 }) })),
      ]),
      runner: new ScannerRunnerService(),
      deduplicator: new KeyedFindingDeduplicator(),
      repository: new MemoryScanRepository(SCAN_ID),
      severityThreshold: 'INFO',
      events: bus,
    });
    const scanResult = await scanService.runStaticScan('https://example.invalid/demo.git');
    expect(scanResult.scanId).toBe(SCAN_ID);

    // ---------------------------------------------------------------- 2. SANDBOX
    const runtime = await root.runtime.service.create({
      scanId: SCAN_ID,
      repository: { name: 'app', path: repoDir },
    });
    expect(runtime.status).toBe('READY');

    // ---------------------------------------------------------------- 3. SCOUT
    const scoutRepo = new MemoryScoutRepository();
    scoutRepo.setContext({
      scanId: SCAN_ID,
      scanStatus: 'COMPLETED',
      repositoryName: 'demo-app',
      repositoryUrl: null,
      staticFindings: 1,
    });
    const scout = new DefaultScoutService({
      repository: scoutRepo,
      config: scoutConfig,
      recon: new StubRecon(),
      events: bus,
      eventsConfig: { endpointCap: 20 },
    });
    await scout.run({ scanId: SCAN_ID, targetUrl: runtime.targetUrl });

    // ---------------------------------------------------------------- 4. SNIPER
    const sniperRepo = new MemorySniperRepository();
    sniperRepo.seedTarget({
      id: 'row-1',
      targetId: 'target-1',
      scanId: SCAN_ID,
      endpoint: '/api/search?q=test',
      method: 'GET',
      candidateVulnerabilities: ['SQL Injection'],
      priority: 97,
      recommendedTool: 'sqlmap',
      reason: 'hypothesis',
      requiresAuthentication: false,
      estimatedRisk: 'CRITICAL',
    });
    const sniper = createSniperInfrastructure({ manager, repository: sniperRepo, events: bus });
    const report = await sniper.service.run({
      scanId: SCAN_ID,
      sandboxId: runtime.sandboxId,
      baseUrl: runtime.targetUrl,
      targetIds: ['target-1'],
      options: { persist: false },
    });
    expect(report.results[0].exploit.status).toBe('CONFIRMED');

    // ---------------------------------------------------------------- 5. ENGINEER
    manager.execQueue.push({ stdout: `${CRITIC_BASE_SOURCE.length}`, stderr: '', exitCode: 0, timedOut: false });
    manager.execQueue.push({ stdout: CRITIC_BASE_SOURCE, stderr: '', exitCode: 0, timedOut: false });
    const engineer = new DefaultEngineerService({
      findings: new MemoryConfirmedFindingRepository([confirmedFinding({ scanId: SCAN_ID, lineNumber: 3 })]),
      patches: new MemoryEngineerPatchRepository(),
      sourceReader: new ManagerSourceReader(manager, { maxSourceBytes: 64_000, maxContextLines: 2_000 }),
      rag: new StubRagService([]),
      registry: PROMPT_REGISTRY,
      llm: (() => {
        const provider = new ProgrammedLLMProvider('pipeline/fake');
        provider.setText(SQLI_PATCH_JSON);
        return provider;
      })(),
      executions: new DefaultAgentExecutionService(new MemoryAgentExecutionRepository()),
      runtimeStore: store,
      bounds: DEFAULT_ENGINEER_BOUNDS,
      maxSourceBytes: 64_000,
      maxContextLines: 2_000,
      defaultContextWindow: 12,
      ragTopK: 4,
      events: bus,
    });
    const engineered = await engineer.run({ scanId: SCAN_ID });
    expect(engineered.status).toBe('GENERATED');

    // ---------------------------------------------------------------- 6. CRITIC
    // Script the fresh-sandbox validation commands.
    manager.execQueue.push({ stdout: `${CRITIC_BASE_SOURCE.length}`, stderr: '', exitCode: 0, timedOut: false });
    manager.execQueue.push({ stdout: CRITIC_BASE_SOURCE, stderr: '', exitCode: 0, timedOut: false });
    const OK = { stdout: '', stderr: '', exitCode: 0, timedOut: false } as const;
    const MISSING = { stdout: '', stderr: '', exitCode: 1, timedOut: false } as const;
    manager.execQueue.push(OK); // python -m py_compile
    manager.execQueue.push(MISSING); // pytest probe
    manager.execQueue.push(MISSING); // conftest probe
    manager.execQueue.push(MISSING); // pyproject probe
    manager.execQueue.push(MISSING); // package.json probe

    const patch = criticPatch({ id: 'patch-pipe', vulnerabilityId: 'vuln-1' });
    const patches = new MemoryPatchReviewRepository();
    patches.seed(patch);
    const findings = new StubCriticFindingResolver();
    findings.seed(patch.id, criticContext({ finding: confirmedFinding({ scanId: SCAN_ID, lineNumber: 3 }) }));
    const results = new MemoryCriticRepository();

    const fixtureWorkspace: RuntimeWorkspaceProvider = {
      prepare: async () => ({ workspacePath: repoDir, repoPath: repoDir }),
      cleanup: async () => undefined,
    };
    const criticRuntime: RuntimeSandboxService = createRuntimeSandboxInfrastructure({
      manager,
      db: fakeDb,
      store,
      registry,
      prober,
      gateway,
      workspace: fixtureWorkspace,
      config: { ...runtimeSandboxConfig, allowHostExpose: true },
    }).service;

    const steps = new CriticSteps({
      runtimeService: criticRuntime,
      sniper: sniper.service,
      applier: new SandboxPatchApplier(
        manager,
        new ManagerSourceReader(manager, { maxSourceBytes: 64_000, maxContextLines: 2_000 }),
        { maxPatchBytes: 16_000, maxSourceBytes: 64_000 }
      ),
      buildCheck: new CriticBuildCheck(manager, { timeoutMs: 5_000, maxOutputChars: 400 }),
      testRunner: new CriticRegressionTestRunner(manager, { timeoutMs: 5_000, maxOutputChars: 600 }),
      securityGate: new CriticSecurityReviewGate(),
      llmReview: new CriticAdvisoryReviewer(null, { get: async () => '' }),
      events: new MemoryCriticEventSink(),
      config: { checkTimeoutMs: 5_000, testTimeoutMs: 5_000, retestTimeoutMs: 5_000, advisoryEnabled: false },
    });
    const critic = new DefaultCriticService({
      patches,
      findings,
      steps,
      events: new MemoryCriticEventSink(),
      outcomes: new CriticOutcomeWriter(results, new DefaultAgentExecutionService(new MemoryAgentExecutionRepository())),
      results,
      eventsBridge: bus,
    });
    const verdict = await critic.run({ patchId: patch.id });
    expect(verdict.status).toBe('APPROVED');

    // ---------------------------------------------------------------- assertions
    const types = events.map((event) => event.eventType);
    expect(events[0].eventType).toBe('SCAN_STARTED');
    expect(events[0].sequence).toBe(1);
    for (const [index, event] of events.entries()) {
      expect(event.scanId).toBe(SCAN_ID);
      if (index > 0) expect(event.sequence).toBeGreaterThan(events[index - 1].sequence);
    }

    const expectedOrder: readonly string[] = [
      'SCAN_STARTED',
      'ANALYZER_STARTED',
      'ANALYZER_COMPLETED',
      'SCANNER_STARTED',
      'SCANNER_COMPLETED',
      'SCAN_COMPLETED',
      'SANDBOX_PROVISIONING',
      'SANDBOX_READY',
      'SCOUT_STARTED',
      'SCOUT_ENDPOINT_DISCOVERED',
      'SCOUT_COMPLETED',
      'SNIPER_STARTED',
      'SNIPER_TARGET_SELECTED',
      'SNIPER_CONFIRMED',
      'SNIPER_VERIFICATION_COMPLETED',
      'ENGINEER_STARTED',
      'ENGINEER_SOURCE_READ',
      'ENGINEER_LLM_STARTED',
      'ENGINEER_LLM_COMPLETED',
      'ENGINEER_PATCH_GENERATED',
      'CRITIC_STARTED',
      'BASELINE_CHECK_STARTED',
      'BASELINE_CHECK_COMPLETED',
      'PATCH_APPLY_STARTED',
      'PATCH_APPLIED',
      'BUILD_STARTED',
      'BUILD_COMPLETED',
      'TESTS_STARTED',
      'TESTS_COMPLETED',
      'EXPLOIT_RETEST_STARTED',
      'EXPLOIT_RETEST_COMPLETED',
      'CRITIC_APPROVED',
    ];
    expect(isSubsequence(expectedOrder, types)).toBe(true);

    const confirmed = events.find((e) => e.eventType === 'SNIPER_CONFIRMED');
    expect(confirmed?.metadata?.targetId).toBe('target-1');
    const approved = events.find((e) => e.eventType === 'CRITIC_APPROVED');
    expect(approved?.metadata?.patchId).toBe('patch-pipe');

    expect(events.length).toBeGreaterThan(28);
  });
});