import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { CloneResult } from '../../domain/models/repository';
import type {
  CloneOptions,
  RepositoryCloner,
} from '../../domain/ports/repository-cloner';
import { RepositoryCloneError } from '../../domain/errors/repository-analysis.errors';
import { logger } from '../../../config/logger';
import type { SandboxRuntime } from '../../../sandbox/domain/ports/sandbox';
import { ProcessSandboxRuntime } from '../../../sandbox/infrastructure/process-sandbox';

export interface GitRepositoryClonerOptions {
  /** Hard timeout for the clone operation in milliseconds. */
  readonly timeoutMs?: number;
  /** Sandbox used for all git invocations (defaults to the process sandbox). */
  readonly sandbox?: SandboxRuntime;
}

/**
 * Clones repositories using the system `git` binary, through the sandbox.
 *
 * Safety properties:
 * - commands are executed without a shell (argv only) so inputs cannot be
 *   injected,
 * - the child environment is allowlisted (no secrets) and `GIT_TERMINAL_PROMPT=0`
 *   disables interactive credential prompts so a private/unreachable
 *   repository fails fast instead of hanging,
 * - shallow clone by default (`--depth 1`) to bound transfer size,
 * - a timeout bounds the whole operation,
 * - `git clone` runs with network enabled (fetching the target is the point);
 *   follow-up commands (`rev-parse`) run with egress blocked,
 * - only clones; never executes repository code.
 */
export class GitRepositoryCloner implements RepositoryCloner {
  private readonly timeoutMs: number;
  private readonly sandbox: SandboxRuntime;

  constructor(options: GitRepositoryClonerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.sandbox = options.sandbox ?? new ProcessSandboxRuntime();
  }

  async clone(url: string, targetPath: string, options?: CloneOptions): Promise<CloneResult> {
    const depth = options?.depth ?? 1;
    const args = ['clone', '--depth', String(depth)];
    if (options?.ref) {
      args.push('--branch', options.ref);
    }
    args.push(url, targetPath);

    const start = Date.now();
    try {
      const out = await this.sandbox.run({
        argv: ['git', ...args],
        cwd: path.dirname(targetPath),
        timeoutMs: this.timeoutMs,
        maxBufferBytes: 10 * 1024 * 1024,
        envAllowlist: ['PATH', 'HOME', 'TMPDIR', 'LANG'],
        envOverrides: { GIT_TERMINAL_PROMPT: '0' },
        network: 'net',
      });
      if (out.exitCode !== 0) {
        throw new Error(`git clone exited ${out.exitCode}: ${truncate(out.stderr)}`);
      }
    } catch (err) {
      logger.warn({ err, url }, 'git clone failed');
      // Best-effort cleanup of a partial clone.
      await this.remove(targetPath);
      throw new RepositoryCloneError(url, err);
    }

    logger.debug(
      { url, targetPath, durationMs: Date.now() - start },
      'Repository cloned'
    );

    const commitSha = await this.readCommitSha(targetPath, url);
    return { path: targetPath, commitSha };
  }

  async remove(targetPath: string): Promise<void> {
    await fs.rm(targetPath, { recursive: true, force: true });
  }

  private async readCommitSha(targetPath: string, url: string): Promise<string | null> {
    try {
      const { stdout, exitCode } = await this.sandbox.run({
        argv: ['git', '-C', targetPath, 'rev-parse', 'HEAD'],
        cwd: targetPath,
        timeoutMs: this.timeoutMs,
        maxBufferBytes: 1024 * 1024,
        envAllowlist: ['PATH', 'HOME'],
        network: 'none',
      });
      return exitCode === 0 ? stdout.trim() || null : null;
    } catch (err) {
      logger.warn({ err, url, targetPath }, 'Failed to resolve HEAD commit SHA');
      return null;
    }
  }
}

function truncate(value: string, max = 200): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}