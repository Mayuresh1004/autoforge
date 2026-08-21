import { describe, expect, it } from 'vitest';
import { SqlInjectionVerifier } from './sql-injection-verifier';
import type { VerificationContext, VerificationTarget } from '../../../domain/models/verification';
import { SQL_INJECTION } from '../../../domain/models/vulnerability-type';
import { FakeToolRuntime, execResult } from '../../../../../test/helpers/fake-tool-runtime';
import {
  SQLMAP_CONNECTION_ERROR,
  SQLMAP_MISSING_BINARY,
  SQLMAP_NOT_INJECTABLE,
  SQLMAP_TOOL_CRASH,
  SQLMAP_VULNERABLE,
} from '../../../../../test/helpers/sniper-fixtures';

function target(): VerificationTarget {
  return { type: SQL_INJECTION, endpoint: 'http://app:3000/api/search?q=1', method: 'GET' };
}

function ctx(runtime: FakeToolRuntime, attempt = 1): VerificationContext {
  return { runtime, timeoutMs: 60_000, attempt, maxAttempts: 3 };
}

describe('SqlInjectionVerifier', () => {
  it('supports SQL_Injection and nothing else (no XSS/SSRF yet)', () => {
    const v = new SqlInjectionVerifier();
    expect(v.supports(SQL_INJECTION)).toBe(true);
    // @ts-expect-error - intentional: unsupported types must be refused
    expect(v.supports('XSS')).toBe(false);
    expect(v.id).toBe('sql-injection');
    expect(v.tool).toBe('sqlmap');
  });

  it('drives the adapter through the injected runtime (sandbox-bound)', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: SQLMAP_VULNERABLE }));
    const v = new SqlInjectionVerifier();

    const out = await v.verify(target(), ctx(runtime));

    expect(runtime.calls).toHaveLength(1);
    expect(out.status).toBe('CONFIRMED');
    expect(out.confidence.score).toBeGreaterThan(0.7);
    expect(out.parameter).toBe('q');
    expect(out.indicator).toBe('sqlmap:injection_point@q');
    expect(out.evidence.length).toBeGreaterThan(2);
  });

  it('maps no-injection output to NOT_CONFIRMED', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: SQLMAP_NOT_INJECTABLE, exitCode: 0 }));
    const out = await new SqlInjectionVerifier().verify(target(), ctx(runtime));
    expect(out.status).toBe('NOT_CONFIRMED');
    expect(out.retryable).toBe(false);
    expect(out.indicator).toBe('sqlmap:no_injection');
  });

  it('maps a missing binary to FAILED and NOT retryable (deterministic refusal)', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(
      execResult({ stdout: SQLMAP_MISSING_BINARY.stdout, stderr: SQLMAP_MISSING_BINARY.stderr, exitCode: 127 })
    );
    const out = await new SqlInjectionVerifier().verify(target(), ctx(runtime));
    expect(out.status).toBe('FAILED');
    expect(out.retryable).toBe(false);
    expect(out.reason).toContain('binary unavailable');
  });

  it('maps a connection error to INCONCLUSIVE and retryable', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: SQLMAP_CONNECTION_ERROR, exitCode: 1 }));
    const out = await new SqlInjectionVerifier().verify(target(), ctx(runtime));
    expect(out.status).toBe('INCONCLUSIVE');
    expect(out.retryable).toBe(true);
    expect(out.reason).toContain('could not reach');
  });

  it('maps a tool crash to FAILED (retryable only as transient)', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: SQLMAP_TOOL_CRASH, exitCode: 1 }));
    const out = await new SqlInjectionVerifier().verify(target(), ctx(runtime));
    expect(out.status).toBe('FAILED');
    expect(out.reason).toContain('tool error');
  });

  it('maps a hard timeout to FAILED with retryable=true', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: '', timedOut: true, exitCode: null }));
    const out = await new SqlInjectionVerifier().verify(target(), ctx(runtime));
    expect(out.status).toBe('FAILED');
    expect(out.retryable).toBe(true);
    expect(out.reason).toContain('timeout');
  });

  it('persists only redacted/truncated summaries in the outcome', async () => {
    const runtime = new FakeToolRuntime();
    const leaky = `${SQLMAP_VULNERABLE}\nCookie: session=topsecret`;
    runtime.script(execResult({ stdout: leaky }));
    const out = await new SqlInjectionVerifier({ summarizeBytes: 512 }).verify(target(), ctx(runtime));
    expect(out.toolSummary).not.toContain('topsecret');
    expect(out.toolSummary.length).toBeLessThanOrEqual(512);
  });

  it('maps HTTP 401/403 or login redirect outputs to NOT_TESTED with an explicit auth reason', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(
      execResult({
        stdout: "[WARNING] got a 302 redirect to 'http://app:3000/login'\n[CRITICAL] all tested parameters do not appear to be injectable",
        exitCode: 0,
      })
    );
    const out = await new SqlInjectionVerifier().verify(target(), ctx(runtime));
    expect(out.status).toBe('NOT_TESTED');
    expect(out.retryable).toBe(false);
    expect(out.reason).toContain('authentication');
  });
});
