import { describe, it, expect } from 'vitest';
import type { ScanTargetProfile } from '../../domain/models/scan-target';
import {
  PIP_AUDIT_JSON,
  mockExecutor,
  okOutput,
  scannerConfig,
  scanContext,
} from '../../../../../../test/helpers/scanner-fixtures';
import { PipAuditScanner } from './pip-audit-scanner';

function pythonProfile(): ScanTargetProfile {
  return {
    languages: ['Python'],
    ecosystems: ['pypi'],
    dependencySources: ['requirements.txt'],
    lockfiles: ['requirements.txt'],
    importantFiles: ['requirements.txt'],
  };
}

describe('PipAuditScanner', () => {
  const context = scanContext({ localPath: '/repo' });

  it('is applicable when a requirements manifest is present', () => {
    const scanner = new PipAuditScanner(mockExecutor({}));
    expect(scanner.isApplicable(pythonProfile())).toBe(true);
    expect(scanner.isApplicable({ ...pythonProfile(), dependencySources: [] })).toBe(false);
  });

  it('normalizes pip-audit JSON into unified findings with CVE + evidence', async () => {
    const scanner = new PipAuditScanner(
      mockExecutor({ 'pip-audit': () => okOutput(PIP_AUDIT_JSON) })
    );
    const run = await scanner.run(context, scannerConfig());
    expect(run.status).toBe('completed');
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0]).toMatchObject({
      scanner: 'pip-audit',
      type: 'GHSA-8q4h-6x2h-9p2j',
      severity: 'HIGH',
      cve: 'CVE-2022-36359',
      evidence: 'django@3.2.0',
    });
  });
});