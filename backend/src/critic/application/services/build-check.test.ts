/**
 * CriticBuildCheck — allowlisted syntax checks (python -m py_compile /
 * node --check) with bounded timeouts + truncated output. Unsupported
 * languages are NOT_AVAILABLE (never a failure by themselves).
 */

import { describe, expect, it } from 'vitest';
import { ProgrammedSandboxManager } from '../../../../test/helpers/programmed-sandbox-manager';
import { CriticBuildCheck } from './build-check';
import type { ExecResult } from '../../../sandbox/domain/models/sandbox';
import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';

const CONTEXT: RuntimeSandboxContext = { id: 'run-1', scanId: 'scan-1', sandboxId: 'sbx-1', targetUrl: 'http://x' } as RuntimeSandboxContext;
const DEFAULTS = { timeoutMs: 30_000, maxOutputChars: 400 };

class ScriptedManager extends ProgrammedSandboxManager {
  readonly rules: Array<{ match: (argv: readonly string[]) => boolean; result: import('../../../../src/sandbox/domain/models/sandbox').ExecResult }> = [];

  rule(argv: readonly string[], result: import('../../../../src/sandbox/domain/models/sandbox').ExecResult): void {
    this.rules.push({ match: (a) => a.join(' ') === argv.join(' ') && argv.every((v, i) => a[i] === v), result });
  }

  async execute(id: string, request: { argv: readonly string[]; timeoutMs?: number }): Promise<ExecResult> {
    super.execute(id, request as never);
    for (const r of this.rules) {
      if (r.match(request.argv)) return r.result;
    }
    return { stdout: '', stderr: '', exitCode: 1, timedOut: false };
  }
}

describe('CriticBuildCheck', () => {
  it('returns NOT_AVAILABLE for unsupported file types', async () => {
    const check = new CriticBuildCheck(new ProgrammedSandboxManager(), DEFAULTS);
    const result = await check.run(CONTEXT, { filePath: 'README.md' });
    expect(result.status).toBe('NOT_AVAILABLE');
  });

  it('returns PASSED when py_compile exits 0', async () => {
    const manager = new ScriptedManager();
    manager.rule(['python', '-m', 'py_compile', 'src/app.py'], { stdout: '', stderr: '', exitCode: 0, timedOut: false });
    const check = new CriticBuildCheck(manager, DEFAULTS);
    const result = await check.run(CONTEXT, { filePath: 'src/app.py' });
    expect(result.status).toBe('PASSED');
  });

  it('returns FAILED with bounded detail when the compile fails', async () => {
    const manager = new ScriptedManager();
    manager.rule(['python', '-m', 'py_compile', 'src/app.py'], { stdout: '', stderr: 'SyntaxError: bad input\n'.repeat(200), exitCode: 1, timedOut: false });
    const check = new CriticBuildCheck(manager, DEFAULTS);
    const result = await check.run(CONTEXT, { filePath: 'src/app.py' });
    expect(result.status).toBe('FAILED');
    expect(result.detail?.length).toBeLessThan(500);
  });

  it('reports timeouts as FAILED', async () => {
    const manager = new ScriptedManager();
    manager.rule(['node', '--check', 'src/app.js'], { stdout: '', stderr: '', exitCode: 0, timedOut: true });
    const check = new CriticBuildCheck(manager, DEFAULTS);
    const result = await check.run(CONTEXT, { filePath: 'src/app.js' });
    expect(result.status).toBe('FAILED');
    expect(result.detail).toContain('timed out');
  });
});