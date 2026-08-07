import { describe, it, expect } from 'vitest';
import { ScannerRunnerService } from './scanner-runner';
import {
  BANDIT_JSON,
  SEMGREP_JSON,
  mockExecutor,
  okOutput,
  scannerConfig,
  scanContext,
} from '../../../../../test/helpers/scanner-fixtures';
import { BanditScanner } from '../scanners/bandit/bandit-scanner';
import { SemgrepScanner } from '../scanners/semgrep/semgrep-scanner';

async function makeRun(outputs: Record<string, ReturnType<typeof okOutput>>) {
  const bandit = new BanditScanner(mockExecutor({ bandit: () => outputs.bandit }));
  const semgrep = new SemgrepScanner(mockExecutor({ semgrep: () => outputs.semgrep }));
  return new ScannerRunnerService().runAll([bandit, semgrep], scanContext({ localPath: '/repo' }));
}

describe('ScannerRunnerService', () => {
  it('runs all scanners and flattens completed results', async () => {
    const results = await makeRun({
      bandit: okOutput(BANDIT_JSON),
      semgrep: okOutput(SEMGREP_JSON),
    });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'completed')).toBe(true);
    expect(results.flatMap((r) => r.findings)).toHaveLength(2); // 1 bandit + 1 semgrep
  });

  it('isolates failures: a broken scanner never aborts/throws', async () => {
    const results = await makeRun({
      bandit: okOutput(BANDIT_JSON),
      semgrep: okOutput('NOT JSON'), // semgrep fails to parse
    });
    const byId = new Map(results.map((r) => [r.scannerId, r]));
    expect(byId.get('bandit')?.status).toBe('completed');
    expect(byId.get('semgrep')?.status).toBe('failed');
    expect(byId.get('semgrep')?.findings).toEqual([]);
  });

  it('records durations and honours a stricter severity threshold', async () => {
    const context = scanContext({ localPath: '/repo', severityThreshold: 'HIGH' });
    const semgrep = new SemgrepScanner(mockExecutor({ semgrep: () => okOutput(SEMGREP_JSON) }));
    const [result] = await new ScannerRunnerService().runAll([semgrep], context);
    expect(result.status).toBe('completed');
    expect(typeof result.durationMs).toBe('number');
    // threshold is still applied inside the scanner based on context
    expect(result.findings[0].severity).toBe('HIGH');
  });
});