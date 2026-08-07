import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RepositoryCloningService } from './repository-cloning.service';
import { GitRepositoryCloner } from '../../infrastructure/git/git-repository-cloner';
import {
  RepositoryTooLargeError,
  InvalidRepositoryUrlError,
} from '../../domain/errors/repository-analysis.errors';
import type { RepositoryUrlResolver } from '../../domain/ports/repository-url-resolver';
import { createGitRepoFixture } from '../../../../test/helpers/git-repo';

function fakeResolver(cloneUrl: string): RepositoryUrlResolver {
  return {
    parse: () => ({
      provider: 'github',
      owner: 'test',
      name: 'repo',
      cloneUrl,
      homepageUrl: 'https://github.com/test/repo',
      defaultBranch: 'main',
    }),
  };
}

describe('RepositoryCloningService', () => {
  const workspaces: string[] = [];

  async function makeWorkspace(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-workspace-'));
    workspaces.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const workspace of workspaces.splice(0)) {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('clones a repository and returns accurate metadata', async () => {
    const fixture = await createGitRepoFixture({
      'README.md': '# hello world',
      'package.json': '{"name":"example","version":"1.0.0"}',
    });

    try {
      const service = new RepositoryCloningService({
        resolver: fakeResolver(fixture.fileUrl),
        cloner: new GitRepositoryCloner({ timeoutMs: 30_000 }),
        workspaceDir: await makeWorkspace(),
      });

      const cloned = await service.clone('https://github.com/test/repo');

      expect(cloned.commitSha).toBe(fixture.commitSha);
      expect(cloned.sizeBytes).toBeGreaterThan(0);
      expect(cloned.identity.name).toBe('repo');
      // The cloned working tree actually contains the fixture files.
      const readme = await fs.readFile(path.join(cloned.localPath, 'README.md'), 'utf8');
      expect(readme).toContain('hello world');

      await service.cleanup(cloned.localPath);
      await expect(fs.access(cloned.localPath)).rejects.toThrow();
    } finally {
      await fixture.cleanup();
    }
  });

  it('cleans up the partial clone and throws when the size limit is exceeded', async () => {
    const fixture = await createGitRepoFixture({ 'big.bin': 'x'.repeat(100_000) });

    try {
      const service = new RepositoryCloningService({
        resolver: fakeResolver(fixture.fileUrl),
        cloner: new GitRepositoryCloner({ timeoutMs: 30_000 }),
        workspaceDir: await makeWorkspace(),
        maxRepoBytes: 1, // intentionally tiny budget
      });

      await expect(service.clone('https://github.com/test/repo')).rejects.toThrow(
        RepositoryTooLargeError
      );

      // The oversized working tree must not be left behind.
      const dirs = await fs.readdir(workspaces[0]);
      expect(dirs).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it('propagates invalid URL errors from the resolver', async () => {
    const service = new RepositoryCloningService({
      resolver: {
        parse: () => {
          throw new InvalidRepositoryUrlError('https://github.com/test/repo');
        },
      },
      cloner: new GitRepositoryCloner({ timeoutMs: 30_000 }),
      workspaceDir: await makeWorkspace(),
    });

    await expect(service.clone('https://github.com/test/repo')).rejects.toThrow(
      InvalidRepositoryUrlError
    );
  });

  it('gives each clone a unique workspace directory', async () => {
    const fixture = await createGitRepoFixture({ 'a.txt': 'a' });

    try {
      const service = new RepositoryCloningService({
        resolver: fakeResolver(fixture.fileUrl),
        cloner: new GitRepositoryCloner({ timeoutMs: 30_000 }),
        workspaceDir: await makeWorkspace(),
      });

      const first = await service.clone('https://github.com/test/repo');
      const second = await service.clone('https://github.com/test/repo');

      expect(first.localPath).not.toBe(second.localPath);

      await service.cleanup(first.localPath);
      await service.cleanup(second.localPath);
    } finally {
      await fixture.cleanup();
    }
  });
});