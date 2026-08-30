import { describe, expect, it } from 'vitest';
import { BrokenAccessControlVerifier } from './broken-access-control-verifier';
import type { VerificationContext, VerificationTarget } from '../../../domain/models/verification';
import { BROKEN_ACCESS_CONTROL, IDOR } from '../../../domain/models/vulnerability-type';
import { FakeToolRuntime, execResult } from '../../../../../test/helpers/fake-tool-runtime';

function target(auth = true): VerificationTarget {
  return {
    targetId: 't-idor-1',
    type: BROKEN_ACCESS_CONTROL,
    endpoint: 'http://app:8080/api/documents/doc_user_A',
    method: 'GET',
    requiresAuthentication: auth,
    credentials: auth ? { header: 'Authorization: Bearer token_user_A' } : undefined,
    attackerCredentials: auth ? { header: 'Authorization: Bearer token_user_B' } : undefined,
  };
}

function ctx(runtime: FakeToolRuntime, auth = true): VerificationContext {
  return {
    scanId: 'scan-1',
    sandboxId: 'sbx-1',
    baseUrl: 'http://app:8080',
    target: target(auth),
    runtime,
    timeoutMs: 10_000,
  };
}

describe('BrokenAccessControlVerifier', () => {
  it('supports BROKEN_ACCESS_CONTROL and IDOR vulnerability types', () => {
    const v = new BrokenAccessControlVerifier();
    expect(v.supports(BROKEN_ACCESS_CONTROL)).toBe(true);
    expect(v.supports(IDOR)).toBe(true);
    // @ts-expect-error - unsupported type check
    expect(v.supports('SQL_INJECTION')).toBe(false);
    expect(v.id).toBe('broken-access-control');
    expect(v.tool).toBe('access-control-prober');
  });

  it('7. confirmed IDOR: User B retrieves User A document with HTTP 200', async () => {
    const runtime = new FakeToolRuntime();
    // Baseline (User A) -> 200 OK
    runtime.script(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n{"id":"doc_user_A","owner":"user_A","content":"confidential"}' }));
    // Attacker Probe (User B) -> 200 OK with User A data returned
    runtime.script(
      execResult({
        stdout: 'HTTP/1.1 200 OK\r\n\r\n{"id":"doc_user_A","owner":"user_A","content":"confidential"}',
      })
    );

    const v = new BrokenAccessControlVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(runtime.calls).toHaveLength(2);
    expect(outcome.status).toBe('CONFIRMED');
    expect(outcome.confidence.score).toBeGreaterThan(0.7);
    expect(outcome.verifier).toBe('broken-access-control');
    expect(outcome.parameter).toBe('id');
    expect(outcome.indicator).toBe('idor:injection_point@id');
  });

  it('8. rejected IDOR: User B access attempt rejected with HTTP 403 Forbidden', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n{"id":"doc_user_A","owner":"user_A"}' }));
    runtime.script(
      execResult({
        stdout: 'HTTP/1.1 403 Forbidden\r\n\r\n{"error":"Access denied. You do not own this document"}',
      })
    );

    const v = new BrokenAccessControlVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(outcome.status).toBe('NOT_CONFIRMED');
    expect(outcome.indicator).toBe('access_control:protected');
    expect(outcome.evidence[0].indicator).toBe('access_control:protected_with_403_or_404');
  });

  it('CASE 1: Public endpoint returns HTTP 200 with {"id":1,"author":"admin","body":"Hello"} -> NOT_CONFIRMED', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n[{"id":1,"author":"admin","body":"Hello"}]' }));
    runtime.script(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n[{"id":1,"author":"admin","body":"Hello"}]' }));

    const publicTarget: VerificationTarget = {
      targetId: 't-pub-1',
      type: BROKEN_ACCESS_CONTROL,
      endpoint: 'http://app:8080/api/comments',
      method: 'GET',
      requiresAuthentication: false,
    };
    const publicCtx: VerificationContext = {
      scanId: 'scan-pub-1',
      sandboxId: 'sbx-pub-1',
      baseUrl: 'http://app:8080',
      target: publicTarget,
      runtime,
      timeoutMs: 10_000,
    };

    const v = new BrokenAccessControlVerifier();
    const outcome = await v.verify(publicTarget, publicCtx);

    expect(outcome.status).toBe('NOT_CONFIRMED');
  });

  it('CASE 2: Authenticated User A accesses resource A. User B accesses resource A. Response identifies victim -> CONFIRMED', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n{"id":1,"name":"Alice","owner":"user_A","email":"alice@example.com"}' }));
    runtime.script(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n{"id":1,"name":"Alice","owner":"user_A","email":"alice@example.com"}' }));

    const v = new BrokenAccessControlVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(outcome.status).toBe('CONFIRMED');
  });

  it('CASE 3: User B receives HTTP 403 Forbidden -> NOT_CONFIRMED', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n{"id":1,"owner":"user_A"}' }));
    runtime.script(execResult({ stdout: 'HTTP/1.1 403 Forbidden\r\n\r\n{"error":"Forbidden"}' }));

    const v = new BrokenAccessControlVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(outcome.status).toBe('NOT_CONFIRMED');
  });

  it('CASE 4: Both users receive public resource with no ownership evidence -> NOT_CONFIRMED', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n[{"id":1,"name":"Widget"}]' }));
    runtime.script(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n[{"id":1,"name":"Widget"}]' }));

    const v = new BrokenAccessControlVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(outcome.status).toBe('NOT_CONFIRMED');
  });

  it('returns NOT_TESTED if target requires authentication but credentials are missing', async () => {
    const runtime = new FakeToolRuntime();
    const unauthTarget: VerificationTarget = {
      targetId: 't-unauth',
      type: BROKEN_ACCESS_CONTROL,
      endpoint: 'http://app:8080/api/documents/doc_user_A',
      method: 'GET',
      requiresAuthentication: true,
    };
    const unauthCtx: VerificationContext = {
      scanId: 'scan-1',
      sandboxId: 'sbx-1',
      baseUrl: 'http://app:8080',
      target: unauthTarget,
      runtime,
      timeoutMs: 10_000,
    };

    const v = new BrokenAccessControlVerifier();
    const outcome = await v.verify(unauthTarget, unauthCtx);

    expect(outcome.status).toBe('NOT_TESTED');
    expect(runtime.calls).toHaveLength(0);
  });
});
