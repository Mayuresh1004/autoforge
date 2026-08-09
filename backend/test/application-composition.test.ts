/**
 * HIGH-1 acceptance — ONE SandboxManager through the whole application.
 *
 * Instead of the old per-route `createSandboxInfrastructure()` calls, the
 * application root (`src/application/application-root.ts`) builds the
 * runtime → sniper → engineer → critic stack over a SINGLE manager. This
 * suite instantiates the real root with a programmable manager and proves
 * cross-agent visibility by BEHAVIOR, not by comparing references:
 *
 *   1. runtime creates sandbox X (real DefaultRuntimeSandboxService);
 *   2. the Sniper (from the root) validates + re-confirms X,
 *   3. the Engineer reads the vulnerable source of X through the root
 *      manager (cat on X recorded against the shared manager),
 *   4. the Critic (real steps, root runtime service, root sniper) provisions
 *      a FRESH sandbox, applies the patch, builds/tests it, re-verifies
 *      FIXED via the real (persist:false) sniper and destroys it — all
 *      through the SAME manager that created X.
 *
 * No Docker/Postgres/network: the manager is programmable, the runtime
 * seams (store/prober/gateway/workspace) are in-memory fakes, the LLM is a
 * programmed stub, and the advisory reviewer is disabled. The full Prisma
 * stack is exercised by the gated docker-compose e2e.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { ExecResult, Sandbox, SandboxPatch } from '../src/sandbox/domain/models/sandbox';
import { createApplicationInfrastructure } from '../src/application/application-root';
import { createRuntimeSandboxInfrastructure } from '../src/sandbox/infrastructure/factory/runtime-sandbox-factory';
import type { RuntimeWorkspaceProvider } from '../src/sandbox/domain/ports/runtime-workspace-provider';
import type { RuntimeSandboxService } from '../src/sandbox/domain/ports/runtime-sandbox-service';
import { FileSystemPromptRegistry, resolvePromptsRoot } from '../src/prompts/infrastructure/fs-prompt-registry';
import { DefaultAgentExecutionService } from '../src/agent/application/services/agent-execution.service';
import { MemoryAgentExecutionRepository } from './helpers/memory-agent-execution-repository';
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
import { SQLMAP_VULNERABLE, SQLMAP_NOT_INJECTABLE } from './helpers/sniper-fixtures';
import { MemorySniperRepository } from './helpers/sniper-repository-memory';
import { MemoryRuntimeSandboxStore } from './helpers/memory-runtime-sandbox-store';
import { MemoryRuntimeSandboxRegistry } from '../src/sandbox/infrastructure/registry/memory-runtime-registry';
import { FakeHealthProber, FakeScanGateway, FakeWorkspaceProvider } from './helpers/runtime-test-fakes';
import { runtimeSandboxConfig } from '../src/config';
import { DefaultCriticService } from '../src/critic/application/services/critic.service';
import { CriticSteps } from '../src/critic/application/services/critic-steps';
import { CriticOutcomeWriter } from '../src/critic/application/services/critic-outcome';
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
  CRITIC_PATCHED_SOURCE,
} from './helpers/critic-fakes';
import { ProgrammedSandboxManager } from './helpers/programmed-sandbox-manager';

const PROMPT_REGISTRY = new FileSystemPromptRegistry(resolvePromptsRoot(process.env.PROMPTS_ROOT));

/** Programmed manager + FIFO exec queue so a scripted sequence can serve
 *  the whole pipeline, with sqlmap run #1 (baseline) = CONFIRMED and every
 *  later run NOT injectable (retest = FIXED). Records applyPatch. */
class CompositionSandboxManager extends ProgrammedSandboxManager {
  private readonly sqlmapRuns = new Map<string, number>();
  private readonly sandboxEpochs = new Map<string, number>();
  execQueue: ExecResult[] = [];
  readonly appliedPatches: Array<{ id: string; patches: readonly SandboxPatch[] }> = [];

  override async execute(
    sandboxId: string,
    request: { argv: readonly string[]; timeoutMs?: number }
  ): Promise<ExecResult> {
    this.execCalls.push({ sandboxId, request });
    if (request.argv[0] === 'sqlmap') {
      // Per-sandbox-creation counter: the critic re-provisions a sandbox
      // under the SAME id, so the epoch distinguishes the two lifecycles.
      // First sqlmap run of each lifecycle CONFIRMS; later runs (the patch
      // re-verification) rule the injection out.
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
    this.appliedPatches.push({ id, patches });
    const sandbox = this.sandboxes.get(id);
    if (!sandbox) throw new Error(`sandbox ${id} not found`);
    return sandbox;
  }
}

const OK = { stdout: '', stderr: '', exitCode: 0, timedOut: false } as const;
const MISSING = { stdout: '', stderr: '', exitCode: 1, timedOut: false } as const;

describe('application composition — ONE SandboxManager shared by every agent', () => {
  let repoDir: string;
  let fakeDb = {} as unknown as PrismaClient;

  beforeAll(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-comp-'));
    await fs.writeFile(path.join(repoDir, 'app.py'), CRITIC_BASE_SOURCE, 'utf8');
  });

  afterAll(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it('runtime-created sandbox is visible to sniper, engineer and critic through the one manager', async () => {
    const manager = new CompositionSandboxManager();
    const store = new MemoryRuntimeSandboxStore();
    const registry = new MemoryRuntimeSandboxRegistry();
    const prober = new FakeHealthProber();
    const gateway = new FakeScanGateway({ missingScan: undefined, relations: {} });
    const workspace = new FakeWorkspaceProvider();

    // Real application root — the SAME manager handed to every factory.
    const root = createApplicationInfrastructure({
      db: fakeDb,
      manager,
      runtime: { store, registry, prober, gateway, workspace, config: { ...runtimeSandboxConfig, allowHostExpose: true } },
      rag: new StubRagService([]),
      llm: null,
      executions: new DefaultAgentExecutionService(new MemoryAgentExecutionRepository()),
    });

    // ---------------------------------------------------------------- 1.
    // Runtime creates sandbox X through the shared manager.
    const runtime = await root.runtime.service.create({
      scanId: 'scan-accept',
      repository: { name: 'app', path: repoDir },
    });
    expect(runtime.status).toBe('READY');
    const X = runtime.sandboxId;
    expect(manager.sandboxes.get(X)).toBeDefined();

    // ---------------------------------------------------------------- 2.
    // The SNIPER from the root validates + executes against X (lookup and
    // exec both go through the manager that owns X — a per-route manager
    // would answer "sandbox not found" here).
    const repository = new MemorySniperRepository();
    repository.seedTarget({
      id: 'row-1',
      targetId: 'target-1',
      scanId: 'scan-accept',
      // Planner-style route (path-relative): the Sniper resolves it against
      // the sandbox base, so the SAME target can be re-validated against the
      // critic's FRESH sandbox (different ip/port) too.
      endpoint: '/api/search?q=test',
      method: 'GET',
      candidateVulnerabilities: ['SQL Injection'],
      priority: 97,
      recommendedTool: 'sqlmap',
      reason: 'hypothesis',
      requiresAuthentication: false,
      estimatedRisk: 'CRITICAL',
    });
    const sniperInfra = createApplicationInfrastructure({
      db: fakeDb,
      manager,
      runtime: { store, registry, prober, gateway, workspace, config: { ...runtimeSandboxConfig, allowHostExpose: true } },
      sniperRepository: repository,
      rag: new StubRagService([]),
      llm: null,
      executions: new DefaultAgentExecutionService(new MemoryAgentExecutionRepository()),
    });

    const report = await sniperInfra.sniper.service.run({
      scanId: 'scan-accept',
      sandboxId: X,
      baseUrl: runtime.targetUrl,
      targetIds: ['target-1'],
      options: { persist: false },
    });
    expect(report.results[0].exploit.status).toBe('CONFIRMED');
    expect(
      manager.execCalls.some((c) => c.sandboxId === X && c.request.argv[0] === 'sqlmap')
    ).toBe(true);

    // ---------------------------------------------------------------- 3.
    // ENGINEER — same manager, real ManagerSourceReader, real service.
    // Script the source reads it will perform on X (wc size + cat).
    manager.execQueue.push({ stdout: `${CRITIC_BASE_SOURCE.length}`, stderr: '', exitCode: 0, timedOut: false });
    manager.execQueue.push({ stdout: CRITIC_BASE_SOURCE, stderr: '', exitCode: 0, timedOut: false });
    const engineer = new DefaultEngineerService({
      findings: new MemoryConfirmedFindingRepository([confirmedFinding({ scanId: 'scan-accept', lineNumber: 3 })]),
      patches: new MemoryEngineerPatchRepository(),
      sourceReader: new ManagerSourceReader(manager, { maxSourceBytes: 64_000, maxContextLines: 2_000 }),
      rag: new StubRagService([]),
      registry: PROMPT_REGISTRY,
      llm: (() => {
        const provider = new ProgrammedLLMProvider('composition/fake');
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
    });
    const engineered = await engineer.run({ scanId: 'scan-accept' });
    expect(engineered.status).toBe('GENERATED');
    expect(
      manager.execCalls.filter((c) => c.sandboxId === X && c.request.argv[0] === 'cat').length
    ).toBeGreaterThan(0);

    // ---------------------------------------------------------------- 4.
    // CRITIC — real steps with the ROOT's runtime service + the ROOT's
    // sniper (the same instance that just confirmed) + the shared manager.
    //
    // Script the commands the critic will run inside ITS fresh sandbox Y:
    //   wc/cat (baseline read for the diff base), py_compile (build),
    //   test-framework probes (none present → tests skipped cleanly).
    manager.execQueue.push({ stdout: `${CRITIC_BASE_SOURCE.length}`, stderr: '', exitCode: 0, timedOut: false });
    manager.execQueue.push({ stdout: CRITIC_BASE_SOURCE, stderr: '', exitCode: 0, timedOut: false });
    manager.execQueue.push(OK); // python -m py_compile src/app.py
    manager.execQueue.push(MISSING); // pytest probe
    manager.execQueue.push(MISSING); // conftest probe
    manager.execQueue.push(MISSING); // pyproject probe
    manager.execQueue.push(MISSING); // package.json probe

    // The critic provisions its fresh sandbox through the REAL runtime
    // service (same manager, same store, real runtime resolver). Its
    // provision call carries no repository, so the workspace seam points at
    // the fixture project — the image context the app was built from.
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

    const patch = criticPatch({ id: 'patch-accept', vulnerabilityId: 'vuln-1' });
    const patches = new MemoryPatchReviewRepository();
    patches.seed(patch);
    const findings = new StubCriticFindingResolver();
    findings.seed(patch.id, criticContext({ finding: confirmedFinding({ scanId: 'scan-accept', lineNumber: 3 }) }));
    const results = new MemoryCriticRepository();
    const executions = new DefaultAgentExecutionService(new MemoryAgentExecutionRepository());

    const steps = new CriticSteps({
      runtimeService: criticRuntime,
      sniper: sniperInfra.sniper.service,
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

    const eventSink = new MemoryCriticEventSink();
    const critic = new DefaultCriticService({
      patches,
      findings,
      steps,
      events: eventSink,
      outcomes: new CriticOutcomeWriter(results, executions),
      results,
    });
    const verdict = await critic.run({ patchId: patch.id });
    expect(verdict.status).toBe('APPROVED');
    expect(verdict.exploit?.baseline.status).toBe('CONFIRMED');
    expect(verdict.exploit?.retest.status).toBe('NOT_CONFIRMED');

    // The critic applied the patch and tore the sandbox down through the
    // shared manager — the SAME records the runtime created.
    expect(manager.appliedPatches).toHaveLength(1);
    expect(manager.appliedPatches[0].patches[0].content).toBe(CRITIC_PATCHED_SOURCE);
    const appliedId = manager.appliedPatches[0].id;
    expect(manager.destroyed).toContain(appliedId);

    const run = await results.listByPatch(patch.id);
    expect(run).toHaveLength(1);
    expect(run[0].status).toBe('APPROVED');
  });
});