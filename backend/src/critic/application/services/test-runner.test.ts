/**
 * CriticRegressionTestRunner — allowlisted discovery (pytest.ini /
 * conftest.py / pyproject pytest section / package.json test script) then
 * executes `python -m pytest -q -x` or `npm test`; absence → NOT_AVAILABLE.
 */

import { describe, expect, it } from 'vitest';
import { ProgrammedSandboxManager } from '../../../../test/helpers/programmed-sandbox-manager';
import { CriticRegressionTestRunner } from './test-runner';
import type { ExecResult } from '../../../../src/sandbox/domain/models/sandbox';
import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';

const CONTEXT: RuntimeSandboxContext = { id: 'sbx-1', sandboxId: 'sbx-1', scanId: 'scan-1', targetUrl: 'http://x' } as RuntimeSandboxContext;
const DEFAULTS = { timeoutMs: 60_000, maxOutputChars: 600 };

class ScriptableManager extends ProgrammedSandboxManager {
  private readonly rules = new Map<string, () => ExecResult>();

  rule(argv: readonly string[], result: ExecResult | (() => ExecResult)): void {
    const key = argv.join('\x1f');
    this.rules.set(key, typeof result === 'function' ? result : () => result);
  }

  async execute(id: string, request: { argv: readonly string[]; timeoutMs?: number }): Promise<ExecResult> {
    this.execCalls.push({ argv: request.argv.join(' ') });
    const hit = this.rules.get(request.argv.join('\x1f'));
    if (hit) {
      const out = hit();
      if (out.timedOut) return out;
      return out;
    }
    return { stdout: '', stderr: '', exitCode: 1, timedOut: false };
  }
}

describe('CriticRegressionTestRunner', () => {
  it('returns NOT_AVAILABLE when no test suite is found', async () => {
    const manager = new ScriptableManager();
    manager.rule(['test', '-e', 'pytest.ini'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['test', '-e', 'conftest.py'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['test', '-e', 'pyproject.toml'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['test', '-e', 'package.json'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    const runner = new CriticRegressionTestRunner(manager, DEFAULTS);
    const result = await runner.run(CONTEXT);
    expect(result.status).toBe('NOT_AVAILABLE');
  });

  it('discovers pytest.ini and runs pytest', async () => {
    const manager = new ScriptableManager();
    manager.rule(['test', '-e', 'pytest.ini'], { stdout: '', stderr: '', exitCode: 0, timedOut: false });
    manager.rule(['python', '-m', 'pytest', '-q', '-x'], { stdout: '1 passed', stderr: '', exitCode: 0, timedOut: false });
    const runner = new CriticRegressionTestRunner(manager, DEFAULTS);
    const result = await runner.run(CONTEXT);
    expect(result.status).toBe('PASSED');
  });

  it('reports failing tests as FAILED with truncated detail', async () => {
    const manager = new ScriptableManager();
    manager.rule(['test', '-e', 'pytest.ini'], { stdout: '', stderr: '', exitCode: 0, timedOut: false });
    manager.rule(['python', '-m', 'pytest', '-q', '-x'], { stdout: 'F'.repeat(500), stderr: 'Traceback …', exitCode: 1, timedOut: false });
    const runner = new CriticRegressionTestRunner(manager, DEFAULTS);
    const result = await runner.run(CONTEXT);
    expect(result.status).toBe('FAILED');
    expect(result.detail?.length).toBeLessThan(700);
  });

  it('detects an npm test script and runs npm test', async () => {
    const manager = new ScriptableManager();
    manager.rule(['test', '-e', 'pytest.ini'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['test', '-e', 'conftest.py'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['test', '-e', 'pyproject.toml'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['test', '-e', 'package.json'], { stdout: '', stderr: '', exitCode: 0, timedOut: false });
    manager.rule(['npm', 'pkg', 'get', 'scripts.test', '--silent'], { stdout: '"vitest run"', stderr: '', exitCode: 0, timedOut: false });
    manager.rule(['npm', 'test'], { stdout: 'ok', stderr: '', exitCode: 0, timedOut: false });
    const runner = new CriticRegressionTestRunner(manager, DEFAULTS);
    const result = await runner.run(CONTEXT);
    expect(result.status).toBe('PASSED');
    expect(manager.execCalls.map((c) => c.argv)).toContain('npm test');
  });

  it('skips npm when package.json has no test script', async () => {
    const manager = new ScriptableManager();
    manager.rule(['test', '-e', 'pytest.ini'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['test', '-e', 'conftest.py'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['test', '-e', 'pyproject.toml'], { stdout: '', stderr: '', exitCode: 1, timedOut: false });
    manager.rule(['test', '-e', 'package.json'], { stdout: '', stderr: '', exitCode: 0, timedOut: false });
    manager.rule(['npm', 'pkg', 'get', 'scripts.test', '--silent'], { stdout: '{}', stderr: '', exitCode: 0, timedOut: false });
    const runner = new CriticRegressionTestRunner(manager, DEFAULTS);
    const result = await runner.run(CONTEXT);
    expect(result.status).toBe('NOT_AVAILABLE');
  });
});