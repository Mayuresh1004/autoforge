import type { RuntimeRepositoryRef } from '../entities/runtime-sandbox';

export interface PreparedWorkspace {
  /** Root of the ephemeral workspace (removed with the sandbox). */
  readonly workspacePath: string;
  /** Directory that holds the repository payload (build context). */
  readonly repoPath: string;
}

/**
 * Prepares an ephemeral workspace for a repository: clones remote URLs
 * (shallow) or copies local paths, then disposes of it. The repository
 * code is never executed here — only transported.
 */
export interface RuntimeWorkspaceProvider {
  prepare(repository: RuntimeRepositoryRef): Promise<PreparedWorkspace>;
  /** Best-effort removal (never throws). */
  cleanup(workspacePath: string): Promise<void>;
}