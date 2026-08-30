import { describe, it, expect } from 'vitest';
import { SecurityMisconfigurationVerifier } from '../src/sniper/infrastructure/verifiers/security-misconfiguration/security-misconfiguration-verifier';
import { DefaultEngineerService } from '../src/engineer/application/services/engineer.service';
import { isSupportedConfirmedFinding } from '../src/engineer/application/services/engineer-selection';

describe('Security Misconfiguration Isolation Verification', () => {
  it('identifies SECURITY_MISCONFIGURATION as a supported confirmed finding for Engineer', () => {
    const mockFinding: any = {
      vulnerabilityId: 'vuln_misconfig_1',
      status: 'CONFIRMED',
      type: 'SECURITY_MISCONFIGURATION',
      severity: 'HIGH',
      confidence: 0.9,
    };

    expect(isSupportedConfirmedFinding(mockFinding)).toBe(true);
  });

  it('runs SecurityMisconfigurationVerifier against a mock debug endpoint', async () => {
    const verifier = new SecurityMisconfigurationVerifier();
    const mockRuntime: any = {
      execute: async () => ({
        exitCode: 0,
        stdout: 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"NODE_ENV":"development","DB_PASSWORD":"secret_pass","DEBUG":true}',
        stderr: '',
        durationMs: 25,
      }),
    };

    const target: any = {
      targetId: 'tgt_misconfig',
      endpoint: 'http://localhost:3000/api/debug/config',
      method: 'GET',
      vulnerabilityType: 'SECURITY_MISCONFIGURATION',
    };

    const context: any = {
      scanId: 'scan_misconfig_test',
      sandboxId: 'sbx_test',
      runtime: mockRuntime,
      timeoutMs: 5000,
    };

    const outcome = await verifier.verify(target, context);
    expect(outcome.status).toBe('CONFIRMED');
    expect(outcome.evidence[0].indicator).toBe('misconfig:sensitive_config_disclosed');
  });
});
