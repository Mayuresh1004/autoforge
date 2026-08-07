import path from 'node:path';
import { promises as fs } from 'node:fs';
import { logger } from '../../../config/logger';
import type { ClonedRepository } from '../../domain/models/repository';
import type { RepositoryUrlResolver } from '../../domain/ports/repository-url-resolver';
import type { RepositoryCloner } from '../../domain/ports/repository-cloner';
import {
  InvalidRepositoryUrlError,
  RepositoryTooLargeError,
} from '../../domain/errors/repository-analysis.errors';
import { getDirectorySizeBytes } from '../../infrastructure/fs/directory-size';
import { analyzerConfig } from '../../../config';

export interface RepositoryCloningServiceOptions {
  readonly resolver: RepositoryUrlResolver;
  readonly cloner: RepositoryCloner;
  readonly workspaceDir?: string;
  readonly maxRepoBytes?: number;
}

/**
 * Application service that takes a repository URL and produces a fully
 * cloned, metadata-tagged working tree.
 *
 * Responsibilities:
 * - resolve + validate the URL via the injected resolver,
 * - clone into a fresh, unique directory inside the managed workspace,
 * - enforce the repository size budget (and clean up when exceeded),
 * - return immutable cloning metadata for downstream analyzers.
 *
 * No repository code is ever executed here.
 */
export class RepositoryCloningService {
  private readonly resolver: RepositoryUrlResolver;
  private readonly cloner: RepositoryCloner;
  private readonly workspaceDir: string;
  private readonly maxRepoBytes: number;

  constructor(options: RepositoryCloningServiceOptions) {
    this.resolver = options.resolver;
    this.cloner = options.cloner;
    this.workspaceDir = options.workspaceDir ?? analyzerConfig.workspaceDir;
    this.maxRepoBytes = options.maxRepoBytes ?? analyzerConfig.maxRepoBytes;
  }

  /**
   * Clones a repository by URL into a fresh workspace directory.
   */
  async clone(repositoryUrl: string): Promise<ClonedRepository> {
    let identity;
    try {
      identity = this.resolver.parse(repositoryUrl);
    } catch (err) {
      if (err instanceof InvalidRepositoryUrlError) throw err;
      throw new InvalidRepositoryUrlError(repositoryUrl);
    }

    await this.ensureWorkspace();

    const localPath = path.join(
      this.workspaceDir,
      `${identity.owner}__${identity.name}__${Date.now()}`
    );
    const clonedAt = new Date();

    try {
      const { commitSha } = await this.cloner.clone(identity.cloneUrl, localPath);

      const sizeBytes = await getDirectorySizeBytes(localPath);
      if (sizeBytes > this.maxRepoBytes) {
        await this.cloner.remove(localPath);
        throw new RepositoryTooLargeError(identity.homepageUrl, sizeBytes, this.maxRepoBytes);
      }

      return {
        identity,
        localPath,
        commitSha,
        sizeBytes,
        clonedAt,
      };
    } catch (err) {
      // Never leak a partial clone back to the caller.
      await this.cloner.remove(localPath).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Removes a cloned working tree. Safe to call during teardown.
   */
  async cleanup(localPath: string): Promise<void> {
    await this.cloner.remove(localPath);
  }

  private async ensureWorkspace(): Promise<void> {
    await fs.mkdir(this.workspaceDir, { recursive: true });
  }
}