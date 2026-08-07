import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'AMASS Test',
  GIT_AUTHOR_EMAIL: 'amass@test.local',
  GIT_COMMITTER_NAME: 'AMASS Test',
  GIT_COMMITTER_EMAIL: 'amass@test.local',
  GIT_TERMINAL_PROMPT: '0',
};

export interface GitRepoFixture {
  /** Absolute path of the fixture working tree. */
  dir: string;
  /** file:// URL suitable for `git clone`. */
  fileUrl: string;
  /** HEAD commit SHA of the fixture. */
  commitSha: string;
  /** Remove the fixture directory. */
  cleanup(): Promise<void>;
}

/**
 * Creates a real, committed git repository on the local filesystem so
 * cloning machinery can be exercised offline (hermetically).
 */
export async function createGitRepoFixture(
  files: Record<string, string> = {}
): Promise<GitRepoFixture> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-fixture-'));

  for (const [relativePath, content] of Object.entries(files)) {
    const full = path.join(dir, relativePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }

  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore', env: GIT_ENV });
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore', env: GIT_ENV });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore', env: GIT_ENV });

  const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: dir,
    encoding: 'utf8',
    env: GIT_ENV,
  }).trim();

  return {
    dir,
    fileUrl: `file://${dir}`,
    commitSha,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}