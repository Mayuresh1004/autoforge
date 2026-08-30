import { describe, it, expect, vi } from 'vitest';
import { SecurityMisconfigurationVerifier } from './security-misconfiguration-verifier';
import type { VerificationContext, VerificationTarget } from '../../../domain/models/verification';
import type { ToolRuntime } from '../../../domain/ports/tool-runtime';

describe('SecurityMisconfigurationVerifier', () => {
  const verifier = new SecurityMisconfigurationVerifier();

  it('supports SECURITY_MISCONFIGURATION type only', () => {
    expect(verifier.supports('SECURITY_MISCONFIGURATION')).toBe(true);
    expect(verifier.supports('SQL_INJECTION')).toBe(false);
    expect(verifier.supports('XSS')).toBe(false);
  });

  it('returns CONFIRMED when endpoint returns HTTP 200 with sensitive environment config', async () => {
    const mockRuntime: ToolRuntime = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"NODE_ENV":"development","DB_PASSWORD":"admin_password_123","DEBUG":true}',
        stderr: '',
        durationMs: 45,
      }),
    };

    const target: VerificationTarget = {
      targetId: 'tgt_misconfig',
      endpoint: 'http://localhost:3000/api/debug/config',
      method: 'GET',
      vulnerabilityType: 'SECURITY_MISCONFIGURATION',
    };

    const context: VerificationContext = {
      scanId: 'scan_1',
      sandboxId: 'sbx_1',
      runtime: mockRuntime,
      timeoutMs: 5000,
    };

    const result = await verifier.verify(target, context);
    expect(result.status).toBe('CONFIRMED');
    expect(result.reason).toContain('Security Misconfiguration confirmed');
    expect(result.confidence.score).toBeGreaterThanOrEqual(0.8);
  });

  it('returns NOT_CONFIRMED when endpoint returns HTTP 403 Forbidden', async () => {
    const mockRuntime: ToolRuntime = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\n\r\n{"error":"Access denied"}',
        stderr: '',
        durationMs: 30,
      }),
    };

    const target: VerificationTarget = {
      targetId: 'tgt_misconfig_protected',
      endpoint: 'http://localhost:3000/api/debug/config',
      method: 'GET',
      vulnerabilityType: 'SECURITY_MISCONFIGURATION',
    };

    const context: VerificationContext = {
      scanId: 'scan_1',
      sandboxId: 'sbx_1',
      runtime: mockRuntime,
      timeoutMs: 5000,
    };

    const result = await verifier.verify(target, context);
    expect(result.status).toBe('NOT_CONFIRMED');
    expect(result.reason).toContain('properly restricted');
  });
});
