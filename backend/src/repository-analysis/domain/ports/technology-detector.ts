import type { FileSystemAnalysis } from '../models/file-system';
import type { TechnologyDetection } from '../models/technology';

/**
 * Port that detects technologies (languages, frameworks, package managers,
 * databases, build tools, container/CI/cloud support) from a scanned working
 * tree.
 *
 * Detection is signature-based and offline: it reads file names, paths,
 * extensions, and a handful of safe manifest files (e.g. package.json,
 * requirements.txt) — never repository code, never secret files.
 */
export interface TechnologyDetector {
  detect(
    analysis: FileSystemAnalysis,
    rootPath: string
  ): Promise<TechnologyDetection>;
}