import type { FileSystemAnalysis } from '../models/file-system';
import type { ApiInventory } from '../models/api';

/**
 * Port that discovers a repository's API surface (routes, protocols) by
 * scanning route declarations in source files.
 *
 * Implementations MUST only *read* source files (never execute), stay
 * size-bounded, and never touch secret files.
 */
export interface ApiAnalyzer {
  analyze(
    analysis: FileSystemAnalysis,
    rootPath: string
  ): Promise<ApiInventory>;
}