/**
 * Critic regression-test runner — bounded, allowlisted discovery + execution
 * inside the disposable sandbox (argv-only via the manager, hard timeouts,
 * truncated output).
 *
 * Discovery (strict allowlist, no shell):
 *   1. `test -e pytest.ini` | `test -e conftest.py` | pyproject with a
 *      [tool.pytest.ini_options] section → `python -m pytest -q -x`
 *   2. `package.json` with a non-empty `scripts.test` → `npm test`
 *   3. otherwise NOT_AVAILABLE (absence of tests is never a failure).
 */

import type { SandboxManager } from '../../../sandbox/domain/ports/sandbox-manager';
import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';

export interface TestRunRequest {
  readonly timeoutMs?: number;
  readonly maxOutputChars?: number;
}

export interface TestRunResult {
  readonly status: 'PASSED' | 'FAILED' | 'NOT_AVAILABLE';
  readonly detail?: string;
  readonly durationMs: number;
}

const SEARCH_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_CHARS = 600;

export class CriticRegressionTestRunner {
  constructor(
    private readonly sandboxes: SandboxManager,
    private readonly defaults: { readonly timeoutMs: number; readonly maxOutputChars: number },
  ) {}

  async run(context: RuntimeSandboxContext, request?: TestRunRequest): Promise<TestRunResult> {
    const started = Date.now();

    const pytest = await this.fileExists(context, 'pytest.ini');
    const conftest = await this.fileExists(context, 'conftest.py');
    const pyprojectPytest =
      (await this.fileExists(context, 'pyproject.toml')) &&
      (await this.pyprojectHasPytestSection(context));

    if (pytest || conftest || pyprojectPytest) {
      return this.execCommand(context, ['python', '-m', 'pytest', '-q', '-x'], started, request);
    }

    if (await this.fileExists(context, 'package.json')) {
      const hasTestScript = await this.npmHasTestScript(context);
      return hasTestScript
        ? this.execCommand(context, ['npm', 'test'], started, request)
        : this.notAvailable(started, 'package.json exists but declares no test script');
    }

    return this.notAvailable(started, 'no test suite found in the repository');
  }

  // ---------- internals ---------------------------------------------------

  private async fileExists(context: RuntimeSandboxContext, name: string): Promise<boolean> {
    try {
      const result = await this.sandboxes.execute(context.sandboxId, {
        argv: ['test', '-e', name],
        timeoutMs: SEARCH_TIMEOUT_MS,
      });
      return result.exitCode === 0 && !result.timedOut;
    } catch {
      return false;
    }
  }

  private async pyprojectHasPytestSection(context: RuntimeSandboxContext): Promise<boolean> {
    try {
      const result = await this.sandboxes.execute(context.sandboxId, {
        argv: ['grep', '-q', 'tool.pytest.ini_options', 'pyproject.toml'],
        timeoutMs: SEARCH_TIMEOUT_MS,
      });
      return result.exitCode === 0 && !result.timedOut;
    } catch {
      return false;
    }
  }

  private async npmHasTestScript(context: RuntimeSandboxContext): Promise<boolean> {
    // `npm pkg get scripts.test` prints the script; empty → no test script.
    try {
      const result = await this.sandboxes.execute(context.sandboxId, {
        argv: ['npm', 'pkg', 'get', 'scripts.test', '--silent'],
        timeoutMs: SEARCH_TIMEOUT_MS,
      });
      if (result.exitCode !== 0 || result.timedOut) return false;
      const value = result.stdout.trim();
      return value.length > 0 && value !== '{}';
    } catch {
      return false;
    }
  }

  private async execCommand(
    context: RuntimeSandboxContext,
    argv: readonly string[],
    started: number,
    request?: TestRunRequest,
  ): Promise<TestRunResult> {
    let result;
    try {
      result = await this.sandboxes.execute(context.sandboxId, {
        argv,
        timeoutMs: request?.timeoutMs ?? this.defaults.timeoutMs,
      });
    } catch (error) {
      return {
        status: 'FAILED',
        detail: error instanceof Error ? error.message.slice(0, 300) : 'test exec failed',
        durationMs: Date.now() - started,
      };
    }
    const durationMs = Date.now() - started;
    if (result.timedOut) {
      return { status: 'FAILED', detail: 'test suite timed out', durationMs };
    }
    if (result.exitCode !== 0) {
      const output = `${result.stderr || result.stdout}`;
      return {
        status: 'FAILED',
        detail: `tests failed (exit ${result.exitCode}): ${truncate(output, request?.maxOutputChars ?? this.defaults.maxOutputChars)}`,
        durationMs,
      };
    }
    return { status: 'PASSED', detail: 'regression tests passed', durationMs };
  }

  private notAvailable(started: number, detail: string): TestRunResult {
    return { status: 'NOT_AVAILABLE', detail, durationMs: Date.now() - started };
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}