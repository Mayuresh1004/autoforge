import type { FileSystemAnalysis } from '../models/file-system';
import type { AuthenticationDetection } from '../models/authentication';

/**
 * Port that identifies authentication approaches (libraries + schemes) and
 * locates auth middleware files.
 */
export interface AuthenticationAnalyzer {
  analyze(
    analysis: FileSystemAnalysis,
    rootPath: string
  ): Promise<AuthenticationDetection>;
}