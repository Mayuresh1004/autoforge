/**
 * Phase 8 acceptance — headless end-to-end of the Critic agent:
 *
 *   GENERATED patch (from a confirmed SQLi) → fresh disposable sandbox
 *   → baseline exploit (CONFIRMED) → unified-diff apply → build → tests
 *   → deterministic security gate → exploit re-verification (NOT_CONFIRMED
 *   ⇒ FIXED) → APPROVED verdict persisted (patch APPROVED, AgentExecution
 *   recorded, sandbox destroyed, original repository untouched).
 *
 * No network, no Docker, no live LLM: runtime + sniper are stubs, the
 * advisory reviewer is disabled, and the sandbox manager is scripted.
 */

import { describe, expect, it } from 'vitest';
import { DefaultCriticService } from '../src/critic/application/services/critic.service';
import { CriticSteps } from '../src/critic/application/services/critic-steps';
import { CriticOutcomeWriter } from '../src/critic/application/services/critic-outcome';
import { SandboxPatchApplier } from '../src/critic/application/services/patch-applier';
import { CriticBuildCheck } from '../src/critic/application/services/build-check';
import { CriticRegressionTestRunner } from '../src/critic/application/services/test-runner';
import { CriticSecurityReviewGate } from '../src/critic/application/services/security-review-gate';
import { CriticAdvisoryReviewer } from '../src/critic/application/services/llm-review';
import { FileSystemPromptRegistry, resolvePromptsRoot } from '../src/prompts/infrastructure/fs-prompt-registry';
import { DefaultAgentExecutionService } from '../src/agent/application/services/agent-execution.service';
import { MemoryAgentExecutionRepository } from './helpers/memory-agent-execution-repository';
import { StubEngineerSourceReader } from './helpers/engineer-fakes';
import {
  MemoryCriticRepository,
  MemoryCriticEventSink,
  MemoryPatchReviewRepository,
  ScriptedSandboxManager,
  StubCriticFindingResolver,
  StubRuntimeSandboxService,
  StubSniperService,
  CRITIC_BASE_SOURCE,
  CRITIC_PATCHED_SOURCE,
  criticPatch,
  criticContext,
} from './helpers/critic-fakes';

const PROMPT_REGISTRY = new FileSystemPromptRegistry(resolvePromptsRoot(process.env.PROMPTS_ROOT));

describe('phase 8 critic acceptance', () => {
  it('approves a patch that neutralizes the confirmed SQLi, touching only the sandbox', async () => {
    const manager = new ScriptedSandboxManager();
    manager.rule(['test', '-e', 'pytest.ini'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['test', '-e', 'conftest.py'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['test', '-e', 'pyproject.toml'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['test', '-e', 'package.json'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['python', '-m', 'py_compile', 'src/app.py'], OK);

    const runtime = new StubRuntimeSandboxService();
    const sniper = new StubSniperService();
    sniper.program('CONFIRMED', 'NOT_CONFIRMED');

    const steps = new CriticSteps({
      runtimeService: runtime,
      sniper,
      applier: new SandboxPatchApplier(manager, new StubEngineerSourceReader({ 'src/app.py': CRITIC_BASE_SOURCE }), {
        maxPatchBytes: 16_000,
        maxSourceBytes: 64_000,
      }),
      buildCheck: new CriticBuildCheck(manager, { timeoutMs: 5_000, maxOutputChars: 400 }),
      testRunner: new CriticRegressionTestRunner(manager, { timeoutMs: 5_000, maxOutputChars: 600 }),
      securityGate: new CriticSecurityReviewGate(),
      llmReview: new CriticAdvisoryReviewer(null, { get: async () => '' }),
      events: new MemoryCriticEventSink(),
      config: { checkTimeoutMs: 5_000, testTimeoutMs: 5_000, retestTimeoutMs: 5_000, advisoryEnabled: false },
    });

    const patches = new MemoryPatchReviewRepository();
    const findings = new StubCriticFindingResolver();
    const results = new MemoryCriticRepository();
    const executions = new DefaultAgentExecutionService(new MemoryAgentExecutionRepository());

    const patch = criticPatch();
    patches.seed(patch);
    findings.seed(patch.id, criticContext());

    const critic = new DefaultCriticService({
      patches,
      findings,
      steps,
      events: new MemoryCriticEventSink(),
      outcomes: new CriticOutcomeWriter(results, executions),
      results,
    });

    const result = await critic.run({ patchId: patch.id });

    expect(result.status).toBe('APPROVED');
    expect(result.exploit?.baseline.status).toBe('CONFIRMED');
    expect(result.exploit?.retest.status).toBe('NOT_CONFIRMED');
    expect(patches.statusOf(patch.id)).toBe('APPROVED');
    // the patch row stays GENERATED→APPROVED: never APPLIED
    expect(patches.statusOf(patch.id)).not.toBe('APPLIED');
    // one sandbox provisioned, one destroyed, patch written only inside it
    expect(runtime.destroyed.length).toBe(1);
    expect(manager.applied).toHaveLength(1);
    expect(manager.applied[0].patches[0].content).toBe(CRITIC_PATCHED_SOURCE);

    const detail = await critic.getRun(result.executionId!);
    expect(detail?.status).toBe('APPROVED');
    expect(detail?.attempt).toBe(1);
  });

  it('rejects an exploit that survives the patch, and hides nothing forever', async () => {
    const manager = new ScriptedSandboxManager();
    manager.rule(['test', '-e', 'pytest.ini'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['test', '-e', 'conftest.py'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['test', '-e', 'pyproject.toml'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['test', '-e', 'package.json'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['python', '-m', 'py_compile', 'src/app.py'], OK);

    const runtime = new StubRuntimeSandboxService();
    const sniper = new StubSniperService();
    sniper.program('CONFIRMED', 'CONFIRMED'); // the injection survives

    const steps = new CriticSteps({
      runtimeService: runtime,
      sniper,
      applier: new SandboxPatchApplier(manager, new StubEngineerSourceReader({ 'src/app.py': CRITIC_BASE_SOURCE }), {
        maxPatchBytes: 16_000,
        maxSourceBytes: 64_000,
      }),
      buildCheck: new CriticBuildCheck(manager, { timeoutMs: 5_000, maxOutputChars: 400 }),
      testRunner: new CriticRegressionTestRunner(manager, { timeoutMs: 5_000, maxOutputChars: 600 }),
      securityGate: new CriticSecurityReviewGate(),
      llmReview: new CriticAdvisoryReviewer(null, { get: async () => '' }),
      events: new MemoryCriticEventSink(),
      config: { checkTimeoutMs: 5_000, testTimeoutMs: 5_000, retestTimeoutMs: 5_000, advisoryEnabled: false },
    });

    const patches = new MemoryPatchReviewRepository();
    const findings = new StubCriticFindingResolver();
    const results = new MemoryCriticRepository();
    const executions = new DefaultAgentExecutionService(new MemoryAgentExecutionRepository());
    const patch = criticPatch();
    patches.seed(patch);
    findings.seed(patch.id, criticContext());

    const critic = new DefaultCriticService({
      patches,
      findings,
      steps,
      events: new MemoryCriticEventSink(),
      outcomes: new CriticOutcomeWriter(results, executions),
      results,
    });

    const result = await critic.run({ patchId: patch.id });

    expect(result.status).toBe('REJECTED');
    expect(result.failureKind).toBe('EXPLOIT_STILL_SUCCEEDS');
    expect(result.feedback?.failedChecks).toContain('exploit-retest');
    expect(patches.statusOf(patch.id)).toBe('REJECTED');
    expect(runtime.destroyed.length).toBe(1);
  });
});

const OK = { stdout: '', stderr: '', exitCode: 0, timedOut: false };
const NOT_FOUND = { stdout: '', stderr: '', exitCode: 1, timedOut: false };