import type { FileSystemAnalysis } from '../models/file-system';
import type { DependencyAnalysis } from '../models/dependencies';

/**
 * Port that parses a repository's dependency manifests and produces a
 * structured summary (versions, runtimes, categories).
 *
 * Implementations MUST only read declaration/specifier files — never secrets
 * (`.env`) and never repository code — and must stay size-bounded.
 */
export interface DependencyAnalyzer {
  analyze(
    analysis: FileSystemAnalysis,
    rootPath: string
  ): Promise<DependencyAnalysis>;
}