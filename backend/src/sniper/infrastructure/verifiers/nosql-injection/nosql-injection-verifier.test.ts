import { describe, expect, it } from 'vitest';
import { NoSqlInjectionVerifier } from './nosql-injection-verifier';
import type { VerificationContext, VerificationTarget } from '../../../domain/models/verification';
import { NOSQL_INJECTION } from '../../../domain/models/vulnerability-type';
import { FakeToolRuntime, execResult } from '../../../../../test/helpers/fake-tool-runtime';

function target(): VerificationTarget {
  return {
    targetId: 't-nosql-1',
    type: NOSQL_INJECTION,
    endpoint: 'http://app:8080/login',
    method: 'POST',
    requiresAuthentication: false,
  };
}

function ctx(runtime: FakeToolRuntime): VerificationContext {
  return {
    scanId: 'scan-1',
    sandboxId: 'sbx-1',
    baseUrl: 'http://app:8080',
    target: target(),
    runtime,
    timeoutMs: 10_000,
  };
}

describe('NoSqlInjectionVerifier', () => {
  it('supports NOSQL_INJECTION vulnerability type', () => {
    const v = new NoSqlInjectionVerifier();
    expect(v.supports(NOSQL_INJECTION)).toBe(true);
    // @ts-expect-error - intentional unsupported check
    expect(v.supports('SQL_INJECTION')).toBe(false);
    expect(v.id).toBe('nosql-injection');
    expect(v.tool).toBe('nosql-prober');
  });

  it('confirms NoSQL injection when operator probe bypasses authentication', async () => {
    const runtime = new FakeToolRuntime();
    // Baseline execution -> 401 Unauthorized
    runtime.script(execResult({ stdout: 'HTTP/1.1 401 Unauthorized\r\n\r\n{"error":"invalid credentials"}' }));
    // Probe execution -> 200 OK with session cookie/welcome signal
    runtime.script(
      execResult({
        stdout: 'HTTP/1.1 200 OK\r\nSet-Cookie: session=abc123token\r\n\r\n{"message":"welcome admin"}',
      })
    );

    const v = new NoSqlInjectionVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(runtime.calls).toHaveLength(2);
    expect(outcome.status).toBe('CONFIRMED');
    expect(outcome.confidence.score).toBeGreaterThan(0.7);
    expect(outcome.verifier).toBe('nosql-injection');
    expect(outcome.parameter).toBe('username');
  });

  it('returns NOT_CONFIRMED when operator probe fails to bypass', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: 'HTTP/1.1 401 Unauthorized\r\n\r\n{"error":"invalid credentials"}' }));
    runtime.script(execResult({ stdout: 'HTTP/1.1 401 Unauthorized\r\n\r\n{"error":"invalid credentials"}' }));

    const v = new NoSqlInjectionVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(outcome.status).toBe('NOT_CONFIRMED');
    expect(outcome.indicator).toBe('nosql:no_injection');
  });

  it('returns INCONCLUSIVE when baseline endpoint execution fails completely', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: '', stderr: 'connection refused', exitCode: 7 }));

    const v = new NoSqlInjectionVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(outcome.status).toBe('INCONCLUSIVE');
    expect(outcome.retryable).toBe(true);
  });
});
