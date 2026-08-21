import { describe, expect, it } from 'vitest';
import { XssVerifier } from './xss-verifier';
import type { VerificationContext, VerificationTarget } from '../../../domain/models/verification';
import { XSS } from '../../../domain/models/vulnerability-type';
import { FakeToolRuntime, execResult } from '../../../../../test/helpers/fake-tool-runtime';

function target(): VerificationTarget {
  return {
    targetId: 't-xss-1',
    type: XSS,
    endpoint: 'http://app:8080/search?q=test',
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

describe('XssVerifier', () => {
  it('supports XSS vulnerability type', () => {
    const v = new XssVerifier();
    expect(v.supports(XSS)).toBe(true);
    // @ts-expect-error - unsupported type check
    expect(v.supports('SQL_INJECTION')).toBe(false);
    expect(v.id).toBe('xss');
    expect(v.tool).toBe('xss-prober');
  });

  it('5. confirmed XSS: script payload reflected unescaped in text/html response', async () => {
    const runtime = new FakeToolRuntime();
    // Baseline -> 200 OK
    runtime.script(execResult({ stdout: 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html>Search</html>' }));
    // Probe -> 200 OK text/html with unescaped script tag
    runtime.script(
      execResult({
        stdout: "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><h1>Results for <script>alert('AMASS_XSS_VERIFIED')</script></h1></html>",
      })
    );

    const v = new XssVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(runtime.calls).toHaveLength(2);
    expect(outcome.status).toBe('CONFIRMED');
    expect(outcome.confidence.score).toBeGreaterThan(0.7);
    expect(outcome.verifier).toBe('xss');
    expect(outcome.parameter).toBe('q');
    expect(outcome.indicator).toBe('xss:injection_point@q');
  });

  it('6. rejected XSS: application/json response or escaped HTML entities', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"status":"ok"}' }));
    runtime.script(
      execResult({
        stdout: 'HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n\r\n{"search":"<script>alert(\'AMASS_XSS_VERIFIED\')</script>"}',
      })
    );

    const v = new XssVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(outcome.status).toBe('NOT_CONFIRMED');
    expect(outcome.indicator).toBe('xss:no_xss');
    expect(outcome.evidence[0].indicator).toBe('xss:safe_json_or_text_response');
  });

  it('returns INCONCLUSIVE when baseline fails completely', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: '', stderr: 'host unreachable', exitCode: 1 }));

    const v = new XssVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(outcome.status).toBe('INCONCLUSIVE');
    expect(outcome.retryable).toBe(true);
  });
});
