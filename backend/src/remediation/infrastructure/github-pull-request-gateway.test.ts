import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { GitHubPullRequestGateway } from './github-pull-request-gateway';
import type { GitRepositoryCloner } from '../../repository-analysis/infrastructure/git/git-repository-cloner';
import type { GitHubUrlResolver } from '../../repository-analysis/infrastructure/git/github-url-resolver';

describe('GitHubPullRequestGateway', () => {
  let tempDir: string;
  let bareRepoDir: string;
  let workRepoDir: string;
  let mockCloner: GitRepositoryCloner;
  let mockUrlResolver: GitHubUrlResolver;
  let gateway: GitHubPullRequestGateway;

  const PATCH_ID = 'patch-123';
  const BASE_BRANCH = 'main';
  const HEAD_BRANCH = `amass/remediation/${PATCH_ID}`;
  const FILE_PATH = 'server/routes/users.js';
  const INITIAL_CONTENT = "const express = require('express');\nconst sql = `SELECT * FROM users WHERE id = '${id}'`;\n";
  const DIFF_CONTENT = `--- a/server/routes/users.js\n+++ b/server/routes/users.js\n@@ -2,1 +2,1 @@\n-const sql = \`SELECT * FROM users WHERE id = '\${id}'\`;\n+const sql = \`SELECT * FROM users WHERE id = ?\`;\n`;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-test-gateway-'));
    bareRepoDir = path.join(tempDir, 'bare-remote.git');
    workRepoDir = path.join(tempDir, 'work-source');

    // 1. Create bare git repository (acts as local remote destination for push)
    execFileSync('git', ['init', '--bare', bareRepoDir], { stdio: 'pipe' });

    // 2. Create seed working repo, populate initial file, commit, and push to bareRepoDir
    await fs.mkdir(path.join(workRepoDir, path.dirname(FILE_PATH)), { recursive: true });
    await fs.writeFile(path.join(workRepoDir, FILE_PATH), INITIAL_CONTENT, 'utf8');

    execFileSync('git', ['init'], { cwd: workRepoDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: workRepoDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workRepoDir, stdio: 'pipe' });
    execFileSync('git', ['add', '.'], { cwd: workRepoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: workRepoDir, stdio: 'pipe' });
    execFileSync('git', ['branch', '-M', 'main'], { cwd: workRepoDir, stdio: 'pipe' });
    execFileSync('git', ['remote', 'add', 'origin', bareRepoDir], { cwd: workRepoDir, stdio: 'pipe' });
    execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: workRepoDir, stdio: 'pipe' });

    mockCloner = {
      clone: vi.fn().mockImplementation(async (_url, targetPath) => {
        // Clone from bareRepoDir locally
        execFileSync('git', ['clone', '--branch', 'main', bareRepoDir, targetPath], { stdio: 'pipe' });
        return { path: targetPath, commitSha: '123456' };
      }),
      remove: vi.fn(),
    } as unknown as GitRepositoryCloner;

    mockUrlResolver = {
      parse: vi.fn().mockReturnValue({
        provider: 'github',
        owner: 'Mayuresh1004',
        name: 'owasp-vuln-lab',
        cloneUrl: bareRepoDir,
        homepageUrl: 'https://github.com/Mayuresh1004/owasp-vuln-lab',
        defaultBranch: 'main',
      }),
    } as unknown as GitHubUrlResolver;

    gateway = new GitHubPullRequestGateway({
      cloner: mockCloner,
      urlResolver: mockUrlResolver,
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('applies exact diff, creates branch, commits, pushes locally, and returns PR metadata', async () => {
    const result = await gateway.createPullRequest({
      owner: 'Mayuresh1004',
      repo: 'owasp-vuln-lab',
      baseBranch: BASE_BRANCH,
      headBranch: HEAD_BRANCH,
      title: '[AMASS] Fix SQL injection in users route',
      body: 'Automated remediation',
      filePath: FILE_PATH,
      diffContent: DIFF_CONTENT,
      patchId: PATCH_ID,
      cloneUrl: 'https://github.com/Mayuresh1004/owasp-vuln-lab.git',
    });

    expect(result.headBranch).toBe(HEAD_BRANCH);
    expect(result.prStatus).toBe('OPEN');
    expect(result.commitSha).toBeTruthy();
    expect(result.prNumber).toBeGreaterThan(0);
    expect(result.prUrl).toContain('Mayuresh1004/owasp-vuln-lab');

    // Verify branch was pushed to bareRepoDir
    const branches = execFileSync('git', ['branch', '-a'], { cwd: bareRepoDir, encoding: 'utf8' });
    expect(branches).toContain(HEAD_BRANCH);
  });

  it('sanitizes tokens from thrown error messages', async () => {
    const secretToken = 'ghp_superSecretToken1234567890';
    const gatewayWithToken = new GitHubPullRequestGateway({
      token: secretToken,
      cloner: mockCloner,
      urlResolver: mockUrlResolver,
    });

    // Provide invalid diff that cannot apply
    const invalidDiff = `--- a/server/routes/users.js\n+++ b/server/routes/users.js\n@@ -99,1 +99,1 @@\n-nonexistent\n+fixed\n`;

    await expect(
      gatewayWithToken.createPullRequest({
        owner: 'Mayuresh1004',
        repo: 'owasp-vuln-lab',
        baseBranch: BASE_BRANCH,
        headBranch: HEAD_BRANCH,
        title: 'Fix',
        body: 'Body',
        filePath: FILE_PATH,
        diffContent: invalidDiff,
        patchId: PATCH_ID,
        cloneUrl: 'https://github.com/Mayuresh1004/owasp-vuln-lab.git',
      })
    ).rejects.toThrow();

    try {
      await gatewayWithToken.createPullRequest({
        owner: 'Mayuresh1004',
        repo: 'owasp-vuln-lab',
        baseBranch: BASE_BRANCH,
        headBranch: HEAD_BRANCH,
        title: 'Fix',
        body: 'Body',
        filePath: FILE_PATH,
        diffContent: invalidDiff,
        patchId: PATCH_ID,
        cloneUrl: 'https://github.com/Mayuresh1004/owasp-vuln-lab.git',
      });
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain(secretToken);
    }
  });

  it('skips git push over network when no GITHUB_TOKEN is configured for an HTTPS URL', async () => {
    const mockHttpResolver = {
      parse: vi.fn().mockReturnValue({
        provider: 'github',
        owner: 'Mayuresh1004',
        name: 'owasp-vuln-lab',
        cloneUrl: 'https://github.com/Mayuresh1004/owasp-vuln-lab.git',
        homepageUrl: 'https://github.com/Mayuresh1004/owasp-vuln-lab',
        defaultBranch: 'main',
      }),
    } as unknown as GitHubUrlResolver;

    const noTokenGateway = new GitHubPullRequestGateway({
      cloner: mockCloner,
      urlResolver: mockHttpResolver,
    });

    const result = await noTokenGateway.createPullRequest({
      owner: 'Mayuresh1004',
      repo: 'owasp-vuln-lab',
      baseBranch: BASE_BRANCH,
      headBranch: HEAD_BRANCH,
      title: 'Fix',
      body: 'Body',
      filePath: FILE_PATH,
      diffContent: DIFF_CONTENT,
      patchId: PATCH_ID,
      cloneUrl: 'https://github.com/Mayuresh1004/owasp-vuln-lab.git',
    });

    expect(result.headBranch).toBe(HEAD_BRANCH);
    expect(result.prUrl).toContain('/pull/mock');
  });
});
