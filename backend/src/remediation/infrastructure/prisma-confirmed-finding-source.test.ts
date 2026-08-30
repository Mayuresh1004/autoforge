import { describe, expect, it } from 'vitest';
import { mapConfirmedFinding } from './prisma-confirmed-finding-source';

describe('mapConfirmedFinding', () => {
  function createMockRow(vulnerabilityType: string) {
    return {
      id: 'exploit-1',
      scanId: 'scan-1',
      vulnerabilityId: 'vuln-1',
      endpoint: 'http://localhost:3000/api/test',
      method: 'GET',
      vulnerabilityType,
      parameter: 'id',
      tool: 'test-tool',
      reason: 'confirmed vulnerability',
      confidence: 0.9,
      attacks: 1,
      status: 'CONFIRMED',
      targetId: 'target-1',
      createdAt: new Date(),
      completedAt: new Date(),
      vulnerability: {
        severity: 'HIGH',
        cweId: 'CWE-284',
        cve: null,
        title: 'Test Title',
        message: 'Test Message',
        filePath: 'src/server.js',
        lineNumber: 10,
        status: 'OPEN',
      },
      attempts: [],
      evidence: [],
    };
  }

  it('preserves SQL_INJECTION vulnerability type', () => {
    const row = createMockRow('SQL_INJECTION');
    const result = mapConfirmedFinding(row);
    expect(result.type).toBe('SQL_INJECTION');
  });

  it('preserves BROKEN_ACCESS_CONTROL vulnerability type', () => {
    const row = createMockRow('BROKEN_ACCESS_CONTROL');
    const result = mapConfirmedFinding(row);
    expect(result.type).toBe('BROKEN_ACCESS_CONTROL');
  });

  it('preserves SECURITY_MISCONFIGURATION vulnerability type', () => {
    const row = createMockRow('SECURITY_MISCONFIGURATION');
    const result = mapConfirmedFinding(row);
    expect(result.type).toBe('SECURITY_MISCONFIGURATION');
  });

  it('preserves XSS vulnerability type', () => {
    const row = createMockRow('XSS');
    const result = mapConfirmedFinding(row);
    expect(result.type).toBe('XSS');
  });
});
