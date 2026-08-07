import type { FileSystemAnalysis } from '../models/file-system';

export interface FileSystemAnalysisOptions {
  /** Extra ignore patterns (gitignore-style) merged over the built-in defaults. */
  readonly ignorePatterns?: readonly string[];
  /** Depth at which the output tree is truncated (stats still cover the whole repo). */
  readonly maxTreeDepth?: number;
  /** Number of entries returned for largest files / largest directories. */
  readonly topN?: number;
}

/**
 * Port for file-system analysis of a cloned working tree.
 *
 * Implementations MUST:
 * - never follow symlinks (stay inside the workspace),
 * - skip generated/secret directories by default (node_modules, .git, dist, .env, ...),
 * - never read or expose secret file contents,
 * - keep the walk single-pass so large repositories stay fast.
 */
export interface FileSystemAnalyzer {
  analyze(
    rootPath: string,
    options?: FileSystemAnalysisOptions
  ): Promise<FileSystemAnalysis>;
}