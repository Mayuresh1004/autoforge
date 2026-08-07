import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitRepositoryCloner } from './git-repository-cloner';
import { RepositoryCloneError } from '../../domain/errors/repository-analysis.errors';
import { createGitRepoFixture } from '../../../../test/helpers/git-repo';

const tempTargets: string[] = [];

async function makeTarget(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-clone-target-'));
  tempTargets.push(dir);
  return path.join(dir, 'repo');
}

afterEach(async () => {
  for (const target of tempTargets.splice(0)) {
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('GitRepositoryCloner', () => {
  it('clones a local repository and resolves the HEAD commit', async () => {
    const fixture = await createGitRepoFixture({ 'file.txt': 'content' });

    try {
      const cloner = new GitRepositoryCloner({ timeoutMs: 30_000 });
      const target = await makeTarget();

      const result = await cloner.clone(fixture.fileUrl, target);

      expect(result.path).toBe(target);
      expect(result.commitSha).toBe(fixture.commitSha);

      const file = await fs.readFile(path.join(target, 'file.txt'), 'utf8');
      expect(file).toBe('content');
    } finally {
      await fixture.cleanup();
    }
  });

  it('cleans up the target directory when cloning fails', async () => {
    const cloner = new GitRepositoryCloner({ timeoutMs: 10_000 });
    const target = await makeTarget();

    await expect(
      cloner.clone('file:///definitely/not/a/real/repository', target)
    ).rejects.toThrow(RepositoryCloneError);

    await expect(fs.access(target)).rejects.toThrow();
  });

  it('remove() deletes the target directory', async () => {
    const cloner = new GitRepositoryCloner({ timeoutMs: 30_000 });
    const target = await makeTarget();
    await fs.mkdir(target, { recursive: true });

    await cloner.remove(target);
    await expect(fs.access(target)).rejects.toThrow();
  });
});