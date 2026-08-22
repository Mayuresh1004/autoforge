import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { logger } from '../../config/logger';
import { GitHubUrlResolver } from '../../repository-analysis/infrastructure/git/github-url-resolver';
import { GitRepositoryCloner } from '../../repository-analysis/infrastructure/git/git-repository-cloner';
import { applyUnifiedDiff } from '../../critic/application/services/apply-unified-diff';
import type {
  CreatePullRequestInput,
  CreatePullRequestResult,
  PullRequestGateway,
} from '../domain/ports/pull-request-gateway';

export interface GitHubPullRequestGatewayOptions {
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly cloner?: GitRepositoryCloner;
  readonly urlResolver?: GitHubUrlResolver;
}

export class GitHubPullRequestGateway implements PullRequestGateway {
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly cloner: GitRepositoryCloner;
  private readonly urlResolver: GitHubUrlResolver;

  constructor(options: GitHubPullRequestGatewayOptions = {}) {
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.cloner = options.cloner ?? new GitRepositoryCloner({ timeoutMs: this.timeoutMs });
    this.urlResolver = options.urlResolver ?? new GitHubUrlResolver();
  }

  async createPullRequest(input: CreatePullRequestInput): Promise<CreatePullRequestResult> {
    const identity = this.urlResolver.parse(input.cloneUrl);
    const owner = input.owner || identity.owner;
    const repo = input.repo || identity.name;

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `amass-delivery-${input.patchId}-`));
    const repoDir = path.join(tempDir, repo);

    try {
      // 1. Clone repository into temporary isolated workspace
      await this.cloner.clone(identity.cloneUrl, repoDir, {
        ref: input.baseBranch,
        depth: 1,
      });

      // 2. Execute git operations in the isolated temp workspace
      const { execFileSync } = await import('node:child_process');
      const git = (args: string[]) =>
        execFileSync('git', args, {
          cwd: repoDir,
          encoding: 'utf8',
          timeout: this.timeoutMs,
          stdio: 'pipe',
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_ASKPASS: 'echo',
          },
        });

      // Create or reuse remediation branch (Case B)
      git(['checkout', '-B', input.headBranch]);

      // 3. Read target file & apply EXACT diffContent
      const targetFilePath = path.join(repoDir, input.filePath);
      let baseContent = '';
      try {
        baseContent = await fs.readFile(targetFilePath, 'utf8');
      } catch (err) {
        throw new Error(`Target file ${input.filePath} does not exist in repository: ${(err as Error).message}`);
      }

      const applyResult = applyUnifiedDiff({ base: baseContent, diff: input.diffContent });
      if (!applyResult.ok) {
        throw new Error(`Approved diff failed to apply cleanly to base file: ${applyResult.reason}`);
      }

      await fs.writeFile(targetFilePath, applyResult.content, 'utf8');

      // 4. Verify working tree contains only expected changes
      const statusOutput = git(['status', '--porcelain']).trim();
      if (!statusOutput) {
        throw new Error('Patch application resulted in no working tree modifications');
      }

      const changedFiles = statusOutput
        .split('\n')
        .map((line) => line.slice(2).trim().replace(/^"|"$/g, ''))
        .filter((f) => f.length > 0);

      const normalizedInputPath = input.filePath.replace(/^\/+/, '');
      const unexpectedFiles = changedFiles.filter((f) => f !== normalizedInputPath);
      if (unexpectedFiles.length > 0) {
        throw new Error(`Patch modified unexpected files: ${unexpectedFiles.join(', ')}`);
      }

      // 5. Commit changes
      git(['config', 'user.name', 'AMASS Bot']);
      git(['config', 'user.email', 'amass-bot@users.noreply.github.com']);
      git(['add', input.filePath]);
      git(['commit', '-m', input.title]);

      const commitSha = git(['rev-parse', 'HEAD']).trim();

      // 6. Push remediation branch
      const isHttpUrl = identity.cloneUrl.startsWith('http://') || identity.cloneUrl.startsWith('https://');

      if (!this.token && isHttpUrl) {
        logger.warn({ patchId: input.patchId }, 'github_delivery: no GITHUB_TOKEN configured; skipping push and returning dry-run PR metadata');
        return {
          prNumber: Math.floor(Math.random() * 900) + 100,
          prUrl: `https://github.com/${owner}/${repo}/pull/mock`,
          commitSha,
          headBranch: input.headBranch,
          prStatus: 'OPEN',
        };
      }

      let pushUrl = identity.cloneUrl;
      if (this.token && isHttpUrl) {
        pushUrl = `https://x-access-token:${encodeURIComponent(this.token)}@github.com/${owner}/${repo}.git`;
      }

      try {
        git(['push', pushUrl, `${input.headBranch}:${input.headBranch}`]);
      } catch (err) {
        const sanitizedMsg = this.sanitizeError(err);
        throw new Error(`Failed to push remediation branch ${input.headBranch}: ${sanitizedMsg}`);
      }

      // 7. Create or Recover GitHub PR via REST API (Case A & C)
      if (!this.token) {
        logger.warn({ patchId: input.patchId }, 'github_delivery: no GITHUB_TOKEN configured; returning mock/dry-run PR metadata');
        return {
          prNumber: Math.floor(Math.random() * 900) + 100,
          prUrl: `https://github.com/${owner}/${repo}/pull/mock`,
          commitSha,
          headBranch: input.headBranch,
          prStatus: 'OPEN',
        };
      }

      // Check if PR already exists remotely for this head branch (Case A recovery)
      const existingPr = await this.findExistingPR(owner, repo, input.headBranch);
      if (existingPr) {
        logger.info({ patchId: input.patchId, prNumber: existingPr.prNumber }, 'github_delivery: recovered existing remote PR metadata');
        return {
          ...existingPr,
          commitSha,
        };
      }

      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'AMASS-Security-System',
        },
        body: JSON.stringify({
          title: input.title,
          head: input.headBranch,
          base: input.baseBranch,
          body: input.body,
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => 'unknown error');
        // Handle 422 error by attempting PR lookup one more time (Case A fallback)
        if (response.status === 422) {
          const recovered = await this.findExistingPR(owner, repo, input.headBranch);
          if (recovered) {
            return { ...recovered, commitSha };
          }
        }
        throw new Error(`GitHub API PR creation failed (${response.status}): ${this.sanitizeMessage(errText)}`);
      }

      const prData = (await response.json()) as { number: number; html_url: string; state: string };
      return {
        prNumber: prData.number,
        prUrl: prData.html_url,
        commitSha,
        headBranch: input.headBranch,
        prStatus: (prData.state || 'OPEN').toUpperCase(),
      };
    } finally {
      // Always cleanup temporary directory
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async findExistingPR(
    owner: string,
    repo: string,
    headBranch: string
  ): Promise<{ prNumber: number; prUrl: string; headBranch: string; prStatus: string } | null> {
    if (!this.token) return null;
    try {
      const searchUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${headBranch}`)}&state=all`;
      const res = await fetch(searchUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'AMASS-Security-System',
        },
      });
      if (!res.ok) return null;
      const pulls = (await res.json()) as Array<{ number: number; html_url: string; state: string }>;
      if (pulls.length > 0) {
        const pr = pulls[0];
        return {
          prNumber: pr.number,
          prUrl: pr.html_url,
          headBranch,
          prStatus: (pr.state || 'OPEN').toUpperCase(),
        };
      }
    } catch {
      // Ignore API errors during background lookup
    }
    return null;
  }

  private sanitizeError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    return this.sanitizeMessage(raw);
  }

  private sanitizeMessage(msg: string): string {
    let sanitized = msg;
    if (this.token) {
      sanitized = sanitized.split(this.token).join('[REDACTED_GITHUB_TOKEN]');
    }
    return sanitized.replace(/https:\/\/[^@]+@github\.com/g, 'https://[REDACTED_CREDS]@github.com').slice(0, 300);
  }
}
