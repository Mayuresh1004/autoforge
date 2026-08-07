import { describe, it, expect } from 'vitest';
import type { ScanTargetProfile } from '../../domain/models/scan-target';
import { DefaultScannerRegistry } from './scanner-registry';
import { BanditScanner } from '../scanners/bandit/bandit-scanner';
import { SemgrepScanner } from '../scanners/semgrep/semgrep-scanner';
import { NpmAuditScanner } from '../scanners/npm-audit/npm-audit-scanner';
import { PipAuditScanner } from '../scanners/pip-audit/pip-audit-scanner';
import { mockExecutor } from '../../../../../test/helpers/scanner-fixtures';

function makeRegistry() {
  return new DefaultScannerRegistry([
    new BanditScanner(mockExecutor({})),
    new PipAuditScanner(mockExecutor({})),
    new SemgrepScanner(mockExecutor({})),
    new NpmAuditScanner(mockExecutor({})),
  ]);
}

const empty = {
  languages: [] as string[],
  ecosystems: [] as string[],
  dependencySources: [] as string[],
  lockfiles: [] as string[],
  importantFiles: [] as string[],
};

describe('DefaultScannerRegistry', () => {
  it('selects Bandit + pip-audit for a Python repo', () => {
    const profile: ScanTargetProfile = {
      ...empty,
      languages: ['Python'],
      ecosystems: ['pypi'],
      dependencySources: ['requirements.txt'],
      importantFiles: ['requirements.txt'],
    };
    const ids = makeRegistry().select(profile).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['bandit', 'pip-audit']));
    expect(ids).not.toContain('semgrep'); // semgrep is JS/TS-only by design
  });

  it('selects Semgrep + npm-audit for an npm repo', () => {
    const profile: ScanTargetProfile = {
      ...empty,
      languages: ['TypeScript'],
      ecosystems: ['npm'],
      dependencySources: ['package.json'],
      lockfiles: ['package-lock.json'],
      importantFiles: ['package.json'],
    };
    const ids = makeRegistry().select(profile).map((s) => s.id);
    expect(ids).toEqual(['semgrep', 'npm-audit']);
  });

  it('returns no scanners for an unknown/Go profile (no guessing)', () => {
    const profile: ScanTargetProfile = {
      ...empty,
      languages: ['Go'],
      ecosystems: ['gomod'],
      importantFiles: ['go.mod'],
    };
    expect(makeRegistry().select(profile)).toEqual([]);
  });
});