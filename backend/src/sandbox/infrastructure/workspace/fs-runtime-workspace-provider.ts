import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '../../../config/logger';
import { InvalidRuntimeRepositoryError } from '../../domain/errors/runtime-sandbox.errors';
import type {
  PreparedWorkspace,
  RuntimeWorkspaceProvider,
} from '../../domain/ports/runtime-workspace-provider';
import type { RuntimeRepositoryRef } from '../../domain/entities/runtime-sandbox';
import type { RepositoryCloner } from '../../../repository-analysis/domain/ports/repository-cloner';

/**
 * Ephemeral workspace lifecycle: mkdtemp under the OS temp root, then either
 * shallow-clone a remote repository (via the shared RepositoryCloner) or copy
 * a local directory. The repository payload is NEVER executed — only
 * transported into a build context.
 */
export class FsRuntimeWorkspaceProvider implements RuntimeWorkspaceProvider {
  constructor(
    private readonly cloner: RepositoryCloner,
    private readonly root = path.join(os.tmpdir(), 'amass-runtime')
  ) {}

  async prepare(repository: RuntimeRepositoryRef): Promise<PreparedWorkspace> {
    await fs.mkdir(this.root, { recursive: true });
    const workspacePath = path.join(this.root, `rt-${randomUUID().slice(0, 12)}`);
    await fs.mkdir(workspacePath, { recursive: true });

    if (repository.url) {
      const repoPath = path.join(workspacePath, 'repo');
      await this.cloner
        .clone(repository.url, repoPath, { depth: 1 })
        .catch((err: unknown) => {
          const detail = err instanceof Error ? err.message : String(err);
          throw new InvalidRuntimeRepositoryError(`clone failed: ${detail}`);
        });
      return { workspacePath, repoPath };
    }

    if (repository.path) {
      const stat = await fs.stat(repository.path).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        throw new InvalidRuntimeRepositoryError(`path is not a directory: ${repository.path}`);
      }
      const repoPath = path.join(workspacePath, 'repo');
      await copyTree(repository.path, repoPath, new Set(['node_modules', '.git', '.venv']));
      return { workspacePath, repoPath };
    }

    logger.warn({ repository }, 'runtime workspace requested without url or path');
    throw new InvalidRuntimeRepositoryError('provide repository.url or repository.path');
  }

  async cleanup(workspacePath: string): Promise<void> {
    await fs.rm(workspacePath, { recursive: true, force: true });
  }
}

/**
 * Copy a local repo tree, skipping heavy/private directories (node_modules,
 * .git, venvs) — the image build context only needs the payload.
 */
async function copyTree(source: string, destination: string, skip: ReadonlySet<string>): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && skip.has(entry.name)) continue;
    const src = path.join(source, entry.name);
    const dest = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyTree(src, dest, skip);
    } else {
      await fs.copyFile(src, dest).catch((err) => {
        logger.warn({ src, err }, 'workspace copy skipped file');
      });
    }
  }
}