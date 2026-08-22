/**
 * DefaultCriticService — full pipeline unit tests (fakes only: no Docker,
 * no database). Covers every verdict (APPROVED / REJECTED / FAILED),
 * failure classification, event + teardown invariants, input gates, and
 * attempt persistence. The original repository is never touched.
 */

import { describe, expect, it } from 'vitest';
import { DefaultAgentExecutionService } from '../../../agent/application/services/agent-execution.service';
import { MemoryAgentExecutionRepository } from '../../../../test/helpers/memory-agent-execution-repository';
import { CriticSteps } from './critic-steps';
import { CriticOutcomeWriter } from './critic-outcome';
import { DefaultCriticService } from './critic.service';
import { SandboxPatchApplier } from './patch-applier';
import { CriticBuildCheck } from './build-check';
import { CriticRegressionTestRunner } from './test-runner';
import { CriticSecurityReviewGate } from './security-review-gate';
import { CriticAdvisoryReviewer } from './llm-review';
import { DefaultValidationStrategyRegistry } from '../../domain/validation/validation-strategy-registry';
import { SqlInjectionValidationStrategy } from '../../domain/validation/strategies/sql-injection-validation-strategy';
import { XssValidationStrategy } from '../../domain/validation/strategies/xss-validation-strategy';
import { AccessControlValidationStrategy } from '../../domain/validation/strategies/access-control-validation-strategy';
import { SecurityMisconfigurationValidationStrategy } from '../../domain/validation/strategies/security-misconfiguration-validation-strategy';
import {
  InvalidPatchStatusError,
  PatchNotFoundError,
  UnsupportedVulnerabilityError,
} from '../../domain/errors/critic.errors';
import { StubEngineerSourceReader } from '../../../../test/helpers/engineer-fakes';
import { CRITIC_FIXTURE_DIFF } from '../../../../test/helpers/critic-fakes';
import {
  MemoryCriticRepository,
  MemoryCriticEventSink,
  MemoryPatchReviewRepository,
  ScriptedSandboxManager,
  StubCriticFindingResolver,
  StubRuntimeSandboxService,
  StubSniperService,
  criticContext,
  criticPatch,
  CRITIC_BASE_SOURCE,
} from '../../../../test/helpers/critic-fakes';

const OK = { stdout: '', stderr: '', exitCode: 0, timedOut: false };
const NOT_FOUND = { stdout: '', stderr: '', exitCode: 1, timedOut: false };

interface EnvOptions {
  readonly baseline?: string;
  readonly retest?: string;
  readonly healthy?: boolean;
  readonly failHealthFrom?: number;
  readonly patchStatus?: string;
  readonly diffOverride?: string;
  readonly filePathOverride?: string;
  readonly findingNotConfirmed?: boolean;
}

interface Env {
  readonly critic: DefaultCriticService;
  readonly patches: MemoryPatchReviewRepository;
  readonly results: MemoryCriticRepository;
  readonly events: MemoryCriticEventSink;
  readonly runtime: StubRuntimeSandboxService;
  readonly sniper: StubSniperService;
  readonly manager: ScriptedSandboxManager;
  readonly patch: ReturnType<typeof criticPatch>;
}

function buildEnv(options: EnvOptions = {}): Env {
  const manager = new ScriptedSandboxManager();
  const reader = new StubEngineerSourceReader({ 'src/app.py': CRITIC_BASE_SOURCE });
  manager.rule(['test', '-e', 'pytest.ini'], NOT_FOUND);
  manager.rule(['test', '-e', 'conftest.py'], NOT_FOUND);
  manager.rule(['test', '-e', 'pyproject.toml'], NOT_FOUND);
  manager.rule(['test', '-e', 'package.json'], NOT_FOUND);
  manager.rule(['python', '-m', 'py_compile', 'src/app.py'], OK);

  const runtime = new StubRuntimeSandboxService();
  runtime.healthy = options.healthy ?? true;
  runtime.failHealthFrom = options.failHealthFrom ?? null;

  const sniper = new StubSniperService();
  sniper.program(options.baseline ?? 'CONFIRMED', options.retest ?? 'NOT_CONFIRMED');

  const events = new MemoryCriticEventSink();

  const steps = new CriticSteps({
    runtimeService: runtime,
    sniper,
    applier: new SandboxPatchApplier(manager, reader, { maxPatchBytes: 16_000, maxSourceBytes: 64_000 }),
    buildCheck: new CriticBuildCheck(manager, { timeoutMs: 5_000, maxOutputChars: 400 }),
    testRunner: new CriticRegressionTestRunner(manager, { timeoutMs: 5_000, maxOutputChars: 600 }),
    securityGate: new CriticSecurityReviewGate(),
    llmReview: new CriticAdvisoryReviewer(null, { get: async () => '' }),
    events,
    config: { checkTimeoutMs: 5_000, testTimeoutMs: 5_000, retestTimeoutMs: 5_000, advisoryEnabled: false },
  });

  const patches = new MemoryPatchReviewRepository();
  const findings = new StubCriticFindingResolver();
  const results = new MemoryCriticRepository();
  const executions = new DefaultAgentExecutionService(new MemoryAgentExecutionRepository());
  const outcomes = new CriticOutcomeWriter(results, executions);

  const patch = criticPatch({
    status: options.patchStatus as never,
    diffContent: options.diffOverride ?? CRITIC_FIXTURE_DIFF,
    filePath: options.filePathOverride ?? 'src/app.py',
  } as never);
  patches.seed(patch);
  findings.seed(patch.id, criticContext({ finding: confirmedFinding(options.findingNotConfirmed) }));

  const strategyRegistry = new DefaultValidationStrategyRegistry([
    new SqlInjectionValidationStrategy(),
    new XssValidationStrategy(),
    new AccessControlValidationStrategy(),
    new SecurityMisconfigurationValidationStrategy(),
  ]);

  const critic = new DefaultCriticService({ patches, findings, strategyRegistry, steps, events, outcomes, results });
  return { critic, patches, results, events, runtime, sniper, manager, patch };
}

function confirmedFinding(notConfirmed = false) {
  const base = criticContext().finding;
  return notConfirmed ? { ...base, status: 'DETECTED' } : base;
}

describe('DefaultCriticService', () => {
  it('APPROVED: full pipeline, patch verdict, events, teardown, persistence', async () => {
    const env = buildEnv();
    const result = await env.critic.run({ patchId: env.patch.id });
    expect(result.status).toBe('APPROVED');
    expect(result.failureKind).toBeNull();
    expect(result.exploit?.baseline.status).toBe('CONFIRMED');
    expect(result.exploit?.retest.status).toBe('NOT_CONFIRMED');
    expect(result.checks.map((c) => c.name)).toContain('exploit-retest');
    expect(env.patches.statusOf(env.patch.id)).toBe('APPROVED');
    expect(env.runtime.destroyed.length).toBe(1);

    const names = env.events.forRun(`${env.patch.id}#1`).map((e) => e.name);
    expect(names[0]).toBe('SANDBOX_PROVISIONING');
    expect(names[names.length - 1]).toBe('SANDBOX_DESTROYED');
    expect(names).toContain('CRITIC_APPROVED');

    const row = await env.results.getById(`${env.patch.id}#1`);
    expect(row?.executionId).toBeTruthy();
  });

  it('REJECTED + EXPLOIT_STILL_SUCCEEDS when the exploit still fires', async () => {
    const env = buildEnv({ retest: 'CONFIRMED' });
    const result = await env.critic.run({ patchId: env.patch.id });

    expect(result.status).toBe('REJECTED');
    expect(result.failureKind).toBe('EXPLOIT_STILL_SUCCEEDS');
    expect(result.feedback?.failedChecks).toContain('exploit-retest');
    expect(env.patches.statusOf(env.patch.id)).toBe('REJECTED');
    expect(env.events.forRun(`${env.patch.id}#1`).map((e) => e.name)).toContain('CRITIC_REJECTED');
    expect(env.runtime.destroyed.length).toBe(1);
  });

  it('FAILED + BASELINE_INVALID when the exploit does not reproduce', async () => {
    const env = buildEnv({ baseline: 'NOT_CONFIRMED' });
    const result = await env.critic.run({ patchId: env.patch.id });

    expect(result.status).toBe('FAILED');
    expect(result.failureKind).toBe('BASELINE_INVALID');
    expect(result.feedback).toBeNull();
    // infra-fail: patch stays UNDER_REVIEW, never flagged as "bad patch"
    expect(env.patches.statusOf(env.patch.id)).toBe('UNDER_REVIEW');
  });

  it('REJECTED + PATCH_REJECTED when the deterministic security gate fails', async () => {
    const leaky = CRITIC_FIXTURE_DIFF.replace('@@ -6,3 +6,3 @@', '@@ -6,3 +6,4 @@').replace(
      '+    cur.execute("SELECT * FROM users WHERE id = %s", (user_input,))',
      '+    cur.execute("SELECT * FROM users WHERE id = %s", (user_input,))\n' +
        '+    password_token = "sk-abc123def456ghi789"',
    );
    const env = buildEnv({ diffOverride: leaky });
    const result = await env.critic.run({ patchId: env.patch.id });

    expect(result.status).toBe('REJECTED');
    expect(result.failureKind).toBe('PATCH_REJECTED');
    expect(result.feedback?.failedChecks).toContain('security-review');
    expect(env.patches.statusOf(env.patch.id)).toBe('REJECTED');
  });

  it('FAILED + SANDBOX_PROVISION_FAILURE when provisioning breaks', async () => {
    const env = buildEnv();
    env.runtime.createError = new Error('docker exploded');
    const result = await env.critic.run({ patchId: env.patch.id });

    expect(result.status).toBe('FAILED');
    expect(result.failureKind).toBe('SANDBOX_PROVISION_FAILURE');
    expect(env.runtime.destroyed.length).toBe(0);
  });

  it('FAILED + APPLICATION_START_FAILURE when the app dies after the patch', async () => {
    // baseline health call (1) ok — startup health call (2) fails
    const env = buildEnv({ failHealthFrom: 2 });
    const result = await env.critic.run({ patchId: env.patch.id });

    expect(result.status).toBe('FAILED');
    expect(result.failureKind).toBe('APPLICATION_START_FAILURE');
    expect(env.runtime.destroyed.length).toBe(1);
  });

  it('FAILED + VALIDATION_INFRASTRUCTURE_FAILURE when the verifier explodes', async () => {
    const env = buildEnv();
    env.sniper.failNext(new Error('sqlmap crashed'));
    const result = await env.critic.run({ patchId: env.patch.id });

    expect(result.status).toBe('FAILED');
    expect(result.failureKind).toBe('VALIDATION_INFRASTRUCTURE_FAILURE');
  });

  it('does not review non-GENERATED patches (deterministic state gate)', async () => {
    const env = buildEnv({ patchStatus: 'GENERATED' });
    env.patches.patches.get(env.patch.id)!.status = 'APPLIED';
    await expect(env.critic.run({ patchId: env.patch.id })).rejects.toBeInstanceOf(InvalidPatchStatusError);
    expect(env.results.rows.size).toBe(0);
  });

  it('does not review patches of unverified vulnerabilities', async () => {
    const env = buildEnv({ findingNotConfirmed: true });
    await expect(env.critic.run({ patchId: env.patch.id })).rejects.toBeInstanceOf(UnsupportedVulnerabilityError);
    expect(env.results.rows.size).toBe(0);
  });

  it('throws 404-style when the patch does not exist', async () => {
    const env = buildEnv();
    await expect(env.critic.run({ patchId: 'missing' })).rejects.toBeInstanceOf(PatchNotFoundError);
  });

  it('never touches the original repo: diff written only inside the sandbox', async () => {
    const env = buildEnv();
    const result = await env.critic.run({ patchId: env.patch.id });
    expect(result.status).toBe('APPROVED');
    expect(env.manager.applied.length).toBe(1);
    const content = env.manager.applied[0].patches[0].content;
    expect(content).toContain('WHERE id = %s');
  });

  it('attempts are never overwritten and a decided patch is sealed', async () => {
    const env = buildEnv({ retest: 'CONFIRMED' }); // deterministic REJECTED verdict
    const first = await env.critic.run({ patchId: env.patch.id, attempt: 1 });
    expect(first.id).toBe(`${env.patch.id}#1`);
    expect(env.results.rows.size).toBe(1);

    await expect(env.critic.run({ patchId: env.patch.id, attempt: 2 })).rejects.toBeInstanceOf(InvalidPatchStatusError);
    expect(env.results.rows.size).toBe(1);

    const viaExec = await env.critic.getRun(first.executionId!);
    expect(viaExec?.id).toBe(first.id);
  });
});