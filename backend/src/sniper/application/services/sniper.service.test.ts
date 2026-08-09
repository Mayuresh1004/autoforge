import { describe, expect, it } from 'vitest';
import {
  SQLMAP_CONNECTION_ERROR,
  SQLMAP_MISSING_BINARY,
  SQLMAP_NOT_INJECTABLE,
  SQLMAP_VULNERABLE,
} from '../../../../test/helpers/sniper-fixtures';
import {
  createSniperHarness,
  stubSandbox,
  TEST_SNIPER_CONFIG,
} from '../../../../test/helpers/sniper-test-harness';
import { execResult } from '../../../../test/helpers/fake-tool-runtime';
import { SandboxUnavailableError } from '../../domain/errors/sniper.errors';
import type { RunSniperInput } from '../../domain/ports/sniper-service';
import type { PlannedTargetSnapshot } from '../../domain/ports/sniper-repository';

const SCAN = 'scan-1';
const SANDBOX = 'sbx_scan-1_abcd1234';
const TARGET = 'target-001';

function sqlTarget(overrides: Partial<PlannedTargetSnapshot> = {}): PlannedTargetSnapshot {
  return {
    id: 'row-1',
    targetId: TARGET,
    scanId: SCAN,
    endpoint: 'http://app:3000/api/search?q=test',
    method: 'GET',
    candidateVulnerabilities: ['SQL Injection'],
    priority: 97,
    recommendedTool: 'sqlmap',
    reason: 'hypothesis',
    requiresAuthentication: false,
    estimatedRisk: 'CRITICAL',
    ...overrides,
  };
}

function runInput(overrides: Partial<RunSniperInput> = {}): RunSniperInput {
  return {
    scanId: SCAN,
    sandboxId: SANDBOX,
    baseUrl: 'http://app:3000/',
    targetIds: [TARGET],
    ...overrides,
  };
}

describe('SniperService — orchestration', () => {
  it('confirms a real SQL injection end-to-end with explainable evidence', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    h.repository.seedTarget(sqlTarget());
    h.repository.seedFindings(SCAN, [
      { id: 'vuln-1', vulnType: 'sqli', cwe: 'CWE-89', confidence: 0.9, severity: 'HIGH' },
    ]);
    h.manager.execQueue.push(execResult({ stdout: SQLMAP_VULNERABLE }));

    const report = await h.service.run(runInput());

    expect(report.results).toHaveLength(1);
    const poc = report.results[0].exploit;
    expect(poc.status).toBe('CONFIRMED');
    expect(poc.parameter).toBe('q');
    expect(poc.type).toBe('SQL_INJECTION');
    expect(poc.vulnerabilityId).toBe('vuln-1');
    expect(poc.attacks).toBe(1);
    expect(poc.confidence).toBeGreaterThan(0.7);

    // Explainable breakdown
    const factors = poc.confidenceBreakdown?.factors ?? [];
    const toolFactor = factors.find((f) => f.category === 'tool_confirmation');
    expect(toolFactor?.score).toBe(1);
    expect(toolFactor?.reason).toContain('confirmed injection');

    // Evidence for reviewers
    expect(poc.evidence.map((e) => e.indicator)).toContain('sqlmap:injection_point');
    expect(poc.evidence.map((e) => e.indicator)).toContain('sqlmap:dbms_identified');

    // Persisted
    expect(h.repository.allExploits).toHaveLength(1);
    expect(h.repository.allAttempts).toHaveLength(1);
  });

  it('records NOT_CONFIRMED when sqlmap rules out injection', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    h.repository.seedTarget(sqlTarget());
    h.manager.execQueue.push(execResult({ stdout: SQLMAP_NOT_INJECTABLE }));

    const poc = (await h.service.run(runInput())).results[0].exploit;
    expect(poc.status).toBe('NOT_CONFIRMED');
    expect(poc.reason).toContain('ruled out');
    expect(poc.attacks).toBe(1);
  });

  it('records INCONCLUSIVE when the endpoint is unreachable (retries transiently)', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    h.repository.seedTarget(sqlTarget());
    // Connection errors are retryable — queue the same failure twice so both
    // attempts fail identically instead of falling through to a default result.
    h.manager.execQueue.push(
      execResult({ stdout: SQLMAP_CONNECTION_ERROR, exitCode: 1 }),
      execResult({ stdout: SQLMAP_CONNECTION_ERROR, exitCode: 1 })
    );

    const poc = (await h.service.run(runInput())).results[0].exploit;
    expect(poc.status).toBe('INCONCLUSIVE');
    expect(poc.reason).toContain('could not reach');
    expect(poc.attacks).toBe(2);
  });

  it('records FAILED (no retry) when the tool binary is missing', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    h.repository.seedTarget(sqlTarget());
    h.manager.execQueue.push(
      execResult({ stdout: SQLMAP_MISSING_BINARY.stdout, stderr: SQLMAP_MISSING_BINARY.stderr, exitCode: 127 })
    );

    const poc = (await h.service.run(runInput())).results[0].exploit;
    expect(poc.status).toBe('FAILED');
    expect(poc.reason).toContain('binary unavailable');
    // Non-transient: no blind retry.
    expect(h.repository.allAttempts).toHaveLength(1);
  });

  it('retries a timed-out attempt (transient) and persists both attempts', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    h.repository.seedTarget(sqlTarget());
    h.manager.execQueue.push(
      execResult({ stdout: '[INFO] starting…', timedOut: true, exitCode: null }),
      execResult({ stdout: SQLMAP_VULNERABLE })
    );

    const poc = (await h.service.run(runInput())).results[0].exploit;
    expect(poc.status).toBe('CONFIRMED');
    expect(poc.attacks).toBe(2);
    const attempts = h.repository.allAttempts;
    expect(attempts).toHaveLength(2);
    expect(attempts[0].status).toBe('FAILED');
    expect(attempts[0].timedOut).toBe(true);
    expect(attempts[1].retried).toBe(true);
  });

  it('keeps FAILED when the max attempts are exhausted', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    h.repository.seedTarget(sqlTarget());
    h.manager.execQueue.push(
      execResult({ timedOut: true, exitCode: null, stdout: 'x' }),
      execResult({ timedOut: true, exitCode: null, stdout: 'x' })
    );

    const poc = (await h.service.run(runInput({ options: { maxAttempts: 2 } }))).results[0].exploit;
    expect(poc.status).toBe('FAILED');
    expect(h.repository.allAttempts).toHaveLength(2);
  });

  it('rejects a run when the sandbox is unavailable (no direct Docker)', async () => {
    const h = createSniperHarness();
    // No sandbox seeded.
    h.repository.seedTarget(sqlTarget());
    await expect(h.service.run(runInput())).rejects.toBeInstanceOf(SandboxUnavailableError);
    expect(h.manager.execCalls).toHaveLength(0); // nothing executed
  });

  it('refuses a target that belongs to another scan', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    h.repository.seedTarget(sqlTarget({ scanId: 'scan-other' }));
    const poc = (await h.service.run(runInput())).results[0].exploit;
    expect(poc.status).toBe('NOT_TESTED');
    expect(poc.reason).toContain('scan');
  });

  it('rejects an invalid/missing planned target with NOT_TESTED', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    const poc = (await h.service.run(runInput())).results[0].exploit;
    expect(poc.status).toBe('NOT_TESTED');
    expect(poc.reason).toContain('Planned target not found');
  });

  it('rejects a cross-origin endpoint — never attacks outside the sandbox app', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    h.repository.seedTarget(sqlTarget({ endpoint: 'https://evil.example.com/api/search?q=x' }));
    const poc = (await h.service.run(runInput())).results[0].exploit;
    expect(poc.status).toBe('NOT_TESTED');
    expect(poc.reason).toContain('not same-origin');
    expect(h.manager.execCalls).toHaveLength(0);
  });

  it('never bypasses authentication: NOT_TESTED without explicit credentials', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    h.repository.seedTarget(sqlTarget({ requiresAuthentication: true }));
    const poc = (await h.service.run(runInput())).results[0].exploit;
    expect(poc.status).toBe('NOT_TESTED');
    expect(poc.reason).toContain('authentication');
    expect(h.manager.execCalls).toHaveLength(0);

    // With explicitly-provided credentials the same target runs.
    h.manager.execQueue.push(execResult({ stdout: SQLMAP_VULNERABLE }));
    const authed = await h.service.run(
      runInput({ credentials: { username: 'alice', password: 'pw', cookie: 'session=s' } })
    );
    expect(authed.results[0].exploit.status).toBe('CONFIRMED');
  });

  it('marks an unsupported candidate type as NOT_TESTED (no XSS/SSRF yet)', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    h.repository.seedTarget(sqlTarget({ candidateVulnerabilities: ['Reflected XSS'] }));
    const poc = (await h.service.run(runInput())).results[0].exploit;
    expect(poc.status).toBe('NOT_TESTED');
    expect(poc.reason).toContain('unsupported');
    expect(h.manager.execCalls).toHaveLength(0);
  });

  it('bounds concurrency: never more than the configured limit in flight', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    h.manager.delayMs = 30;
    const ids = Array.from({ length: 6 }, (_, i) => `t-${i + 1}`);
    for (const id of ids) h.repository.seedTarget(sqlTarget({ targetId: id, id: `row-${id}` }));
    for (let i = 0; i < ids.length * 2; i += 1) {
      h.manager.execQueue.push(execResult({ stdout: SQLMAP_VULNERABLE }));
    }

    const report = await h.service.run(runInput({ targetIds: ids, options: { concurrency: 2 } }));

    expect(report.results).toHaveLength(6);
    expect(report.results.every((r) => r.exploit.status === 'CONFIRMED')).toBe(true);
    // Two worker slots only → peak overlap must never exceed the limit.
    expect(maxOverlap(h.manager.execCalls, h.manager.delayMs)).toBeLessThanOrEqual(2);
  });

  it('a single tool failure does not crash the whole run', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    h.repository.seedTarget(sqlTarget({ targetId: 'bad', id: 'row-bad' }));
    h.repository.seedTarget(sqlTarget({ targetId: 'good', id: 'row-good' }));
    h.manager.execQueue.push(
      execResult({ stdout: SQLMAP_MISSING_BINARY.stdout, stderr: SQLMAP_MISSING_BINARY.stderr, exitCode: 127 }),
      execResult({ stdout: SQLMAP_VULNERABLE })
    );

    const report = await h.service.run(runInput({ targetIds: ['bad', 'good'] }));
    const bad = report.results.find((r) => r.targetId === 'bad')?.exploit;
    const good = report.results.find((r) => r.targetId === 'good')?.exploit;
    expect(bad?.status).toBe('FAILED');
    expect(good?.status).toBe('CONFIRMED');
  });

  it('redacts secrets and truncates tool summaries before persistence', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    h.repository.seedTarget(sqlTarget({ endpoint: 'http://app:3000/api/search?q=test&Authorization=Bearer%20secret' }));
    const leaky = `${SQLMAP_VULNERABLE}\nAuthorization: Bearer abcdef123456\nSet-Cookie: session=supersecret`;
    h.manager.execQueue.push(execResult({ stdout: leaky }));

    const poc = (await h.service.run(runInput())).results[0].exploit;
    const stored = h.repository.allAttempts[0].stdout ?? '';
    expect(stored).not.toContain('abcdef123456');
    expect(stored).not.toContain('supersecret');
    expect(stored).toContain('[redacted]');
  });

  it('dry-run (persist:false) verifies WITHOUT writing any repository rows (MEDIUM-4)', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    h.repository.seedTarget(sqlTarget());
    h.manager.execQueue.push(execResult({ stdout: SQLMAP_VULNERABLE }));

    const countRows = () => h.repository.allExploits.length + h.repository.allAttempts.length;
    const before = countRows();

    const report = await h.service.run(
      runInput({ options: { timeoutMs: 5_000, maxAttempts: 2, persist: false } })
    );

    expect(report.results[0].exploit.status).toBe('CONFIRMED');
    // Same verdict, identical evidence — but ZERO writes to the repository.
    expect(report.results[0].exploit.evidence.length).toBeGreaterThan(0);
    expect(countRows()).toBe(before);
    expect(report.results[0].exploit.id).toContain('in-memory');
  });

  it('dry-run refusal (persist:false) also leaves the repository untouched', async () => {
    const h = createSniperHarness();
    h.manager.seed(stubSandbox(SANDBOX, SCAN));
    h.repository.seedTarget(sqlTarget({ requiresAuthentication: true }));

    const countRows = () => h.repository.allExploits.length + h.repository.allAttempts.length;
    const before = countRows();
    const report = await h.service.run(runInput({ options: { persist: false } }));

    expect(report.results[0].exploit.status).toBe('NOT_TESTED');
    expect(countRows()).toBe(before);
  });
});

/** Peak simultaneous executions, measured via stub start timestamps. */
function maxOverlap(
  calls: Array<{ startedAt: number }>,
  delayMs: number
): number {
  let peak = 0;
  for (const a of calls) {
    const window = Array.from({ length: delayMs }, (_, i) => i);
    void window; // (delayMs already consumed in the stub; interval math uses starts)
  }
  const windows = calls.map((c) => ({ start: c.startedAt, end: c.startedAt + delayMs }));
  for (const cand of windows) {
    const concurrent = windows.filter((w) => w.start < cand.end && cand.start < w.end).length;
    peak = Math.max(peak, concurrent);
  }
  return peak;
}