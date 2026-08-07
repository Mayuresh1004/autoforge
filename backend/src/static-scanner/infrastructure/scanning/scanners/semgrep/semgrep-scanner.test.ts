import { describe, it, expect } from 'vitest';
import type { ScanTargetProfile } from '../../domain/models/scan-target';
import {
  SEMGREP_JSON,
  mockExecutor,
  okOutput,
  scannerConfig,
  scanContext,
} from '../../../../../../test/helpers/scanner-fixtures';
import { SemgrepScanner } from './semgrep-scanner';

describe('SemgrepScanner', () => {
  const context = scanContext({ localPath: '/repo' });

  it('is applicable to JS/TS and Python projects', () => {
    const scanner = new SemgrepScanner(mockExecutor({}));
    expect(scanner.isApplicable({ ...profile(), languages: ['TypeScript'] })).toBe(true);
    expect(scanner.isApplicable({ ...profile(), languages: ['JavaScript'] })).toBe(true);
    expect(scanner.isApplicable({ ...profile(), languages: ['Python'] })).toBe(false);
    expect(scanner.isApplicable({ ...profile(), languages: ['Go'] })).toBe(false);
  });

  it('normalizes semgrep JSON into unified findings with relative paths', async () => {
    const scanner = new SemgrepScanner(mockExecutor({ semgrep: () => okOutput(SEMGREP_JSON) }));
    const run = await scanner.run(context, scannerConfig());
    expect(run.status).toBe('completed');
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0]).toMatchObject({
      scanner: 'semgrep',
      type: 'typescript.lang.security.audit.sqli',
      severity: 'HIGH',
      file: 'src/user.ts',
      line: 42,
      cwe: 'CWE-89',
    });
  });

  it('returns failed run on output errors without throwing', async () => {
    const scanner = new SemgrepScanner(mockExecutor({ semgrep: () => okOutput('nope') }));
    const run = await scanner.run(context, scannerConfig());
    expect(run.status).toBe('failed');
  });

  function profile(): ScanTargetProfile {
    return {
      languages: ['TypeScript'],
      ecosystems: ['npm'],
      dependencySources: [],
      lockfiles: [],
      importantFiles: [],
    };
  }
});