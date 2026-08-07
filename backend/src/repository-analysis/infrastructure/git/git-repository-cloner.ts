import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import type { CloneResult } from '../../domain/models/repository';
import type {
  CloneOptions,
  RepositoryCloner,
} from '../../domain/ports/repository-cloner';
import { RepositoryCloneError } from '../../domain/errors/repository-analysis.errors';
import { logger } from '../../../config/logger';

const execFileAsync = promisify(execFile);

export interface GitRepositoryClonerOptions {
  /** Hard timeout for the clone operation in milliseconds. */
  readonly timeoutMs?: number;
}

/**
 * Clones repositories using the system `git` binary.
 *
 * Safety properties:
 * - commands are executed without a shell (argv only) so inputs cannot be
 *   injected,
 * - shallow clone by default (`--depth 1`) to bound transfer size,
 * - `GIT_TERMINAL_PROMPT=0` disables interactive credential prompts so a
 *   private/unreachable repository fails fast instead of hanging,
 * - a timeout bounds the whole operation,
 * - only clones; never executes repository code.
 */
export class GitRepositoryCloner implements RepositoryCloner {
  private readonly timeoutMs: number;

  constructor(options: GitRepositoryClonerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
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
      await execFileAsync('git', args, {
        timeout: this.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
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
      const { stdout } = await execFileAsync('git', ['-C', targetPath, 'rev-parse', 'HEAD'], {
        timeout: this.timeoutMs,
        maxBuffer: 1024 * 1024,
      });
      return stdout.trim() || null;
    } catch (err) {
      logger.warn({ err, url, targetPath }, 'Failed to resolve HEAD commit SHA');
      return null;
    }
  }
}