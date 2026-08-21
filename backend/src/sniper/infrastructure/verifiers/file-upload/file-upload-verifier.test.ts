import { describe, expect, it } from 'vitest';
import { FileUploadVerifier } from './file-upload-verifier';
import type { VerificationContext, VerificationTarget } from '../../../domain/models/verification';
import { FILE_UPLOAD } from '../../../domain/models/vulnerability-type';
import { FakeToolRuntime, execResult } from '../../../../../test/helpers/fake-tool-runtime';

function target(): VerificationTarget {
  return {
    targetId: 't-file-1',
    type: FILE_UPLOAD,
    endpoint: 'http://app:8080/api/upload',
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

describe('FileUploadVerifier', () => {
  it('supports FILE_UPLOAD vulnerability type', () => {
    const v = new FileUploadVerifier();
    expect(v.supports(FILE_UPLOAD)).toBe(true);
    // @ts-expect-error - unsupported type check
    expect(v.supports('SQL_INJECTION')).toBe(false);
    expect(v.id).toBe('file-upload');
    expect(v.tool).toBe('file-upload-prober');
  });

  it('1. confirmed FILE_UPLOAD: payload accepted and reachable', async () => {
    const runtime = new FakeToolRuntime();
    // Baseline -> 200 OK
    runtime.script(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n{"status":"ready"}' }));
    // Probe -> 201 Created with static uploads path reference
    runtime.script(
      execResult({
        stdout: 'HTTP/1.1 201 Created\r\n\r\n{"file_id":"exploit_poc.py","url":"/static/uploads/exploit_poc.py"}',
      })
    );

    const v = new FileUploadVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(runtime.calls).toHaveLength(2);
    expect(outcome.status).toBe('CONFIRMED');
    expect(outcome.confidence.score).toBeGreaterThan(0.7);
    expect(outcome.verifier).toBe('file-upload');
    expect(outcome.indicator).toBe('file_upload:injection_point@file');
  });

  it('2. rejected FILE_UPLOAD: HTTP 400 with invalid file extension policy', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n{"status":"ready"}' }));
    runtime.script(
      execResult({
        stdout: 'HTTP/1.1 400 Bad Request\r\n\r\n{"error":"Invalid file extension. Rejected"}',
      })
    );

    const v = new FileUploadVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(outcome.status).toBe('NOT_CONFIRMED');
    expect(outcome.indicator).toBe('file_upload:no_upload_vulnerability');
    expect(outcome.evidence[0].indicator).toBe('file_upload:rejected_by_extension_policy');
  });

  it('returns INCONCLUSIVE when baseline fails completely', async () => {
    const runtime = new FakeToolRuntime();
    runtime.script(execResult({ stdout: '', stderr: 'connection refused', exitCode: 7 }));

    const v = new FileUploadVerifier();
    const outcome = await v.verify(target(), ctx(runtime));

    expect(outcome.status).toBe('INCONCLUSIVE');
    expect(outcome.retryable).toBe(true);
  });
});
