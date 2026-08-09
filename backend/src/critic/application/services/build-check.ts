/**
 * Critic bounded build check. Only ALLOWLISTED syntax checks are ever run
 * inside the disposable sandbox — never arbitrary LLM-composed commands.
 * Each check is argv-only, has a hard timeout, and its output is
 * truncated to a bounded detail string. Unsupported languages are
 * NOT_AVAILABLE (absence is never treated as failure by itself).
 */

import type { SandboxManager } from '../../../sandbox/domain/ports/sandbox-manager';
import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';

export interface BuildCheckRequest {
  readonly filePath: string;
  readonly maxOutputChars?: number;
  readonly timeoutMs?: number;
}

export interface BuildCheckResult {
  readonly status: 'PASSED' | 'FAILED' | 'NOT_AVAILABLE';
  readonly detail?: string;
  readonly durationMs: number;
}

export interface LanguageDetector {
  primaryLanguage(): string | null;
  fileMatch(path: string): boolean;
}

const PYTHON_EXT = /\.py$/i;
const JS_EXT = /\.(m?js|cjs|jsx|ts|tsx)$/i;

function supportedCommand(filePath: string): { readonly argv: readonly string[] } | null {
  if (PYTHON_EXT.test(filePath)) {
    return { argv: ['python', '-m', 'py_compile', filePath] };
  }
  if (JS_EXT.test(filePath)) {
    return { argv: ['node', '--check', filePath] };
  }
  return null;
}

export class CriticBuildCheck {
  constructor(
    private readonly sandboxes: SandboxManager,
    private readonly defaults: { readonly timeoutMs: number; readonly maxOutputChars: number },
  ) {}

  async run(context: RuntimeSandboxContext, request: BuildCheckRequest): Promise<BuildCheckResult> {
    const command = supportedCommand(request.filePath);
    if (!command) {
      return { status: 'NOT_AVAILABLE', detail: 'no allowlisted build/syntax check for this file type', durationMs: 0 };
    }
    const started = Date.now();
    let result;
    try {
      result = await this.sandboxes.execute(context.sandboxId, {
        argv: command.argv,
        timeoutMs: request.timeoutMs ?? this.defaults.timeoutMs,
      });
    } catch (error) {
      return {
        status: 'FAILED',
        detail: error instanceof Error ? error.message.slice(0, 200) : 'build check exec failed',
        durationMs: Date.now() - started,
      };
    }
    const durationMs = Date.now() - started;
    if (result.timedOut) {
      return { status: 'FAILED', detail: 'build check timed out', durationMs };
    }
    if (result.exitCode !== 0) {
      const output = `${result.stderr || result.stdout}`;
      return {
        status: 'FAILED',
        detail: truncate(output, request.maxOutputChars ?? this.defaults.maxOutputChars),
        durationMs,
      };
    }
    return { status: 'PASSED', detail: 'syntax check passed', durationMs };
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}