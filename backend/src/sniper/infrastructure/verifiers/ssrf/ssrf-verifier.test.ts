import { describe, expect, it } from 'vitest';
import { SsrfVerifier } from './ssrf-verifier';
import type { VerificationContext, VerificationTarget } from '../../../domain/models/verification';
import { SSRF } from '../../../domain/models/vulnerability-type';
import { FakeToolRuntime, execResult } from '../../../../../test/helpers/fake-tool-runtime';

function target(): VerificationTarget {
  return {
    targetId: 't-ssrf-1',
    type: SSRF,
    endpoint: 'http://app:8080/api/fetch?url=https://example.com',
    method: 'GET',
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

describe('SsrfVerifier', () => {
  it('supports SSRF vulnerability type', () => {
    const v = new SsrfVerifier();
    expect(v.supports(SSRF)).toBe(true);
    // @ts-expect-error - unsupported type check
    expect(v.supports('SQL_INJECTION')).toBe(false);
    expect(v.id).toBe('ssrf');
    expect(v.tool).toBe('ssrf-prober');
  });

  it('3. confirmed SSRF: fetches internal health endpoint', async () => {
    const runtime = new FakeToolRuntime();
    // Baseline -> 200 OK
    runtime.script(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n{"status":"ok"}' }));
    // Probe -> 200 OK returning internal health payload
    runtime.script(
      execResult({
        stdout: 'HTTP/1.1 200 OK\r\n\r\n{"content":"{\\"status\\":\\"UP\\"}"}',
      })
    );

    const v = new SsrfVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(runtime.calls).toHaveLength(2);
    expect(outcome.status).toBe('CONFIRMED');
    expect(outcome.confidence.score).toBeGreaterThan(0.7);
    expect(outcome.verifier).toBe('ssrf');
    expect(outcome.parameter).toBe('url');
    expect(outcome.indicator).toBe('ssrf:injection_point@url');
  });

  it('4. rejected SSRF: private IP blocked with HTTP 400', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n{"status":"ok"}' }));
    runtime.script(
      execResult({
        stdout: 'HTTP/1.1 400 Bad Request\r\n\r\n{"error":"Forbidden target URL or private IP address"}',
      })
    );

    const v = new SsrfVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(outcome.status).toBe('NOT_CONFIRMED');
    expect(outcome.indicator).toBe('ssrf:no_ssrf');
    expect(outcome.evidence[0].indicator).toBe('ssrf:private_ip_blocked');
  });

  it('returns INCONCLUSIVE when baseline probe fails completely', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: '', stderr: 'connection reset', exitCode: 56 }));

    const v = new SsrfVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(outcome.status).toBe('INCONCLUSIVE');
    expect(outcome.retryable).toBe(true);
  });
});
