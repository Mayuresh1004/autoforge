/**
 * Domain models produced by file-system analysis.
 */

export interface FileInfo {
  readonly name: string;
  /** Path relative to the analyzed root, e.g. `src/index.ts`. */
  readonly relativePath: string;
  readonly absolutePath: string;
  /** Lowercase extension without the dot; `'(none)'` when absent. */
  readonly extension: string;
  readonly sizeBytes: number;
  /** Approximate line count for text files, `null` for binaries/oversized. */
  readonly linesOfCode: number | null;
}

export interface DirectoryNode {
  readonly name: string;
  /** '' for the root, e.g. `src/utils` otherwise. */
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly directories: DirectoryNode[];
  readonly files: FileInfo[];
  /** Total size of everything in this directory (including descendants). */
  readonly totalSizeBytes: number;
}

export type ImportantFileCategory =
  | 'manifest'
  | 'config'
  | 'container'
  | 'ci'
  | 'docs'
  | 'lockfile'
  | 'infra'
  | 'other';

export interface ImportantFile {
  readonly name: string;
  /** Path if the file/dir was found, null otherwise. */
  readonly relativePath: string | null;
  readonly category: ImportantFileCategory;
}

export interface LargestEntry {
  readonly relativePath: string;
  readonly sizeBytes: number;
}

export interface FileSystemAnalysis {
  readonly rootPath: string;
  /** Full directory tree (truncated for output via maxTreeDepth). */
  readonly tree: DirectoryNode;
  /** Every non-ignored file in the workspace (unordered). */
  readonly files: readonly FileInfo[];
  readonly fileCount: number;
  readonly folderCount: number;
  readonly totalSizeBytes: number;
  /** Approximate total lines of code across analyzable text files. */
  readonly linesOfCode: number;
  /** Count of files per lowercase extension (key `'(none)'` = no extension). */
  readonly filesByExtension: Record<string, number>;
  /** Top N files by size. */
  readonly largestFiles: FileInfo[];
  /** Top N directories by total size (excluding the root). */
  readonly largestDirectories: LargestEntry[];
  readonly importantFiles: ImportantFile[];
}