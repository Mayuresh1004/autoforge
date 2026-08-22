import { describe, it, expect } from 'vitest';
import { SecurityMisconfigurationVerifier } from './security-misconfiguration-verifier';
import type { VerificationTarget, VerificationContext } from '../../../domain/models/verification';
import { SECURITY_MISCONFIGURATION, SQL_INJECTION } from '../../../domain/models/vulnerability-type';

describe('SecurityMisconfigurationVerifier', () => {
  const verifier = new SecurityMisconfigurationVerifier();

  it('supports SECURITY_MISCONFIGURATION vulnerability type', () => {
    expect(verifier.supports(SECURITY_MISCONFIGURATION)).toBe(true);
    expect(verifier.supports(SQL_INJECTION)).toBe(false);
  });

  it('Task 3 Case 1: Vulnerable response (200 + sensitive config) → CONFIRMED', async () => {
    const target: VerificationTarget = {
      targetId: 't1',
      endpoint: '/api/debug/config',
      method: 'GET',
      vulnerabilityType: SECURITY_MISCONFIGURATION,
      requiresAuthentication: false,
    };

    const mockRuntime: any = {
      execute: async () => ({
        exitCode: 0,
        stdout: [
          'HTTP/1.1 200 OK',
          'Content-Type: application/json',
          '',
          JSON.stringify({
            debug: true,
            jwtSecret: 'supersecret123',
            dbPath: '/var/data/lab.db',
            defaultAdmin: { username: 'admin', password: 'admin123' },
          }),
        ].join('\r\n'),
        stderr: '',
      }),
    };

    const context: VerificationContext = {
      runtime: mockRuntime,
      timeoutMs: 5000,
    };

    const outcome = await verifier.verify(target, context);
    expect(outcome.status).toBe('CONFIRMED');
    expect(outcome.evidence[0].indicator).toBe('security_misconfig:sensitive_config_disclosed');
  });

  it('Task 3 Case 2: Protected endpoint (403 Forbidden) → NOT_CONFIRMED', async () => {
    const target: VerificationTarget = {
      targetId: 't1',
      endpoint: '/api/debug/config',
      method: 'GET',
      vulnerabilityType: SECURITY_MISCONFIGURATION,
      requiresAuthentication: true,
    };

    const mockRuntime: any = {
      execute: async () => ({
        exitCode: 0,
        stdout: 'HTTP/1.1 403 Forbidden\r\n\r\n{"error":"Forbidden"}',
        stderr: '',
      }),
    };

    const context: VerificationContext = {
      runtime: mockRuntime,
      timeoutMs: 5000,
    };

    const outcome = await verifier.verify(target, context);
    expect(outcome.status).toBe('NOT_CONFIRMED');
  });

  it('Task 3 Case 3: Missing endpoint (404 Not Found) → NOT_CONFIRMED', async () => {
    const target: VerificationTarget = {
      targetId: 't1',
      endpoint: '/api/debug/config',
      method: 'GET',
      vulnerabilityType: SECURITY_MISCONFIGURATION,
      requiresAuthentication: false,
    };

    const mockRuntime: any = {
      execute: async () => ({
        exitCode: 0,
        stdout: 'HTTP/1.1 404 Not Found\r\n\r\n{"error":"Not Found"}',
        stderr: '',
      }),
    };

    const context: VerificationContext = {
      runtime: mockRuntime,
      timeoutMs: 5000,
    };

    const outcome = await verifier.verify(target, context);
    expect(outcome.status).toBe('NOT_CONFIRMED');
  });

  it('Task 3 Case 4: Sanitized response (200 OK but no sensitive config) → NOT_CONFIRMED', async () => {
    const target: VerificationTarget = {
      targetId: 't1',
      endpoint: '/api/debug/config',
      method: 'GET',
      vulnerabilityType: SECURITY_MISCONFIGURATION,
      requiresAuthentication: false,
    };

    const mockRuntime: any = {
      execute: async () => ({
        exitCode: 0,
        stdout: 'HTTP/1.1 200 OK\r\n\r\n{"status":"healthy"}',
        stderr: '',
      }),
    };

    const context: VerificationContext = {
      runtime: mockRuntime,
      timeoutMs: 5000,
    };

    const outcome = await verifier.verify(target, context);
    expect(outcome.status).toBe('NOT_CONFIRMED');
  });

  it('Task 3 Case 5: Network/tool failure → INCONCLUSIVE', async () => {
    const target: VerificationTarget = {
      targetId: 't1',
      endpoint: '/api/debug/config',
      method: 'GET',
      vulnerabilityType: SECURITY_MISCONFIGURATION,
      requiresAuthentication: false,
    };

    const mockRuntime: any = {
      execute: async () => ({
        exitCode: 7,
        stdout: '',
        stderr: 'curl: (7) Failed to connect to host',
      }),
    };

    const context: VerificationContext = {
      runtime: mockRuntime,
      timeoutMs: 5000,
    };

    const outcome = await verifier.verify(target, context);
    expect(outcome.status).toBe('INCONCLUSIVE');
  });
});
