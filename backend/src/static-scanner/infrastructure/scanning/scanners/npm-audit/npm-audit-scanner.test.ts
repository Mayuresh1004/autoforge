import { describe, it, expect } from 'vitest';
import type { ScanTargetProfile } from '../../domain/models/scan-target';
import {
  NPM_AUDIT_JSON,
  mockExecutor,
  okOutput,
  scannerConfig,
  scanContext,
} from '../../../../../../test/helpers/scanner-fixtures';
import { NpmAuditScanner } from './npm-audit-scanner';

function nodeProfile(): ScanTargetProfile {
  return {
    languages: ['TypeScript'],
    ecosystems: ['npm'],
    dependencySources: ['package.json'],
    lockfiles: ['package-lock.json'],
    importantFiles: ['package.json', 'package-lock.json'],
  };
}

describe('NpmAuditScanner', () => {
  const context = scanContext({ localPath: '/repo' });

  it('is applicable only to npm ecosystems', () => {
    const scanner = new NpmAuditScanner(mockExecutor({}));
    expect(scanner.isApplicable(nodeProfile())).toBe(true);
    expect(scanner.isApplicable({ ...nodeProfile(), ecosystems: ['pypi'] })).toBe(false);
  });

  it('parses npm audit even when it exits non-zero (vulnerabilities present)', async () => {
    const scanner = new NpmAuditScanner(
      mockExecutor({ 'npm audit': () => okOutput(NPM_AUDIT_JSON, 1) })
    );
    const run = await scanner.run(context, scannerConfig());
    expect(run.status).toBe('completed');
    expect(run.findings).toHaveLength(2);

    const lodash = run.findings.find((f) => f.type.includes('Prototype Pollution'));
    expect(lodash).toMatchObject({ severity: 'MEDIUM', file: null, line: null });
    expect(lodash?.references).toContain('https://github.com/advisories/GHSA-abc');

    const minimist = run.findings.find((f) => f.type.includes('GHSA-xvch'));
    expect(minimist).toMatchObject({ severity: 'CRITICAL', scanner: 'npm-audit' });
  });

  it('returns no findings for a clean audit and failed on bad output', async () => {
    const clean = new NpmAuditScanner(
      mockExecutor({
        'npm audit': () => okOutput(JSON.stringify({ metadata: {}, vulnerabilities: {} }), 0),
      })
    );
    expect((await clean.run(context, scannerConfig())).findings).toHaveLength(0);

    const bad = new NpmAuditScanner(mockExecutor({ 'npm audit': () => okOutput('junk') }));
    expect((await bad.run(context, scannerConfig())).status).toBe('failed');
  });
});