import { describe, it, expect } from 'vitest';
import type { ScanTargetProfile } from '../../../domain/models/scan-target';
import {
  BANDIT_JSON,
  mockExecutor,
  okOutput,
  timedOutOutput,
  scannerConfig,
  scanContext,
} from '../../../../../../test/helpers/scanner-fixtures';
import { BanditScanner } from './bandit-scanner';

function pythonProfile(): ScanTargetProfile {
  return {
    languages: ['Python'],
    ecosystems: ['pypi'],
    dependencySources: ['requirements.txt'],
    lockfiles: [],
    importantFiles: ['requirements.txt'],
  };
}

describe('BanditScanner', () => {
  const context = scanContext({ localPath: '/repo' });

  it('is applicable to Python projects', () => {
    expect(new BanditScanner(mockExecutor({})).isApplicable(pythonProfile())).toBe(true);
    expect(
      new BanditScanner(mockExecutor({})).isApplicable({
        languages: ['TypeScript'],
        ecosystems: ['npm'],
        dependencySources: [],
        lockfiles: [],
        importantFiles: [],
      })
    ).toBe(false);
  });

  it('parses bandit JSON output into unified findings with relative paths', async () => {
    const scanner = new BanditScanner(
      mockExecutor({ bandit: () => okOutput(BANDIT_JSON) })
    );
    const run = await scanner.run(context, scannerConfig());
    expect(run.status).toBe('completed');
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0]).toMatchObject({
      scanner: 'bandit',
      type: 'hardcoded_sql_expressions',
      severity: 'HIGH',
      confidence: 0.9,
      file: 'src/db.py',
      line: 12,
      cwe: 'CWE-89',
    });
  });

  it('treats unparsable output as a completed-but-empty or failed run without throwing', async () => {
    const scanner = new BanditScanner(mockExecutor({ bandit: () => okOutput('not json') }));
    const run = await scanner.run(context, scannerConfig());
    expect(run.status).toBe('failed');
  });

  it('reports a timeout as a failed run (never throws)', async () => {
    const scanner = new BanditScanner(mockExecutor({ bandit: () => timedOutOutput() }));
    const run = await scanner.run(context, scannerConfig());
    expect(run.status).toBe('failed');
  });
});