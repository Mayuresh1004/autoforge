import type { FileSystemAnalysis } from '../models/file-system';
import type { ArchitectureDetection } from '../models/architecture';

/**
 * Port that infers the repository's overall architecture from structural
 * signals (directory layout, manifests, entry points).
 *
 * Implementations MUST NOT guess: when no candidate reaches the confidence
 * threshold, `primary` is null and consumers report `Unknown`.
 */
export interface ArchitectureAnalyzer {
  analyze(
    analysis: FileSystemAnalysis,
    rootPath: string
  ): Promise<ArchitectureDetection>;
}