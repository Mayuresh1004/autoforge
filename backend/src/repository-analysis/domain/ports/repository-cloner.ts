import type { CloneResult } from '../models/repository';

export interface CloneOptions {
  /** Specific ref/commit to check out. Defaults to the remote default branch. */
  readonly ref?: string;
  /** Shallow clone depth (defaults to 1). */
  readonly depth?: number;
}

/**
 * Port that clones a repository into a local working tree.
 *
 * The implementation must:
 * - never execute repository code (clone only),
 * - disable interactive credential prompts,
 * - enforce a timeout,
 * - clean up after itself on failure.
 */
export interface RepositoryCloner {
  clone(url: string, targetPath: string, options?: CloneOptions): Promise<CloneResult>;
  remove(targetPath: string): Promise<void>;
}