/**
 * Engineer source-reader port — bounded, read-only access to a scanned
 * repository's source files. The implementation runs `wc`/`cat` through the
 * EXISTING SandboxManager.execute seam (argv-only, allowlisted env, hard
 * timeout). Engineer never touches Docker directly.
 *
 * Safety invariants enforced by implementations:
 *  - paths are relative to the repository root and validated (no traversal)
 *  - reads are size-bounded (max bytes) and line-bounded (max context lines)
 *  - only whole files are read; line windows are applied client-side
 */

import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';

export interface SourceReadRequest {
  /** Repository-relative path (normalized; see repo-path). */
  readonly path: string;
  /** 1-based start line (whole file when omitted). */
  readonly startLine?: number | null;
  /** Inclusive 1-based end line (whole file when omitted). */
  readonly endLine?: number | null;
  /** Max file size to accept (bytes). Defaults to the configured bound. */
  readonly maxBytes?: number;
}

export interface SourceReadResult {
  /** The normalized path that was read. */
  readonly filePath: string;
  /** Requested window of lines, in order. */
  readonly lines: readonly string[];
  /** 1-based line number of `lines[0]` in the file. */
  readonly offset: number;
  /** True when the file was truncated (exceeded max lines — never silently partial for the source window). */
  readonly truncated: boolean;
  /** Raw byte length of the file (pre-truncation). */
  readonly byteLength: number;
}

export interface ReadWholeFileResult {
  /** The normalized path that was read. */
  readonly filePath: string;
  /** Whole file content (bounded by maxBytes). */
  readonly content: string;
  /** Raw byte length of the file (pre-truncation). */
  readonly byteLength: number;
}

export interface EngineerSourceReader {
  /**
   * Read a bounded window of a file inside the sandbox.
   * Throws EngineerSourceError for invalid paths, missing files,
   * oversized files, exec failures.
   */
  read(context: RuntimeSandboxContext, request: SourceReadRequest): Promise<SourceReadResult>;
  /**
   * Read an ENTIRE file (bounded by maxBytes, no line cap) — used by the
   * Critic to reconstruct the diff base deterministically. Same safety
   * invariants as read().
   */
  readWholeFile(context: RuntimeSandboxContext, request: SourceReadRequest): Promise<ReadWholeFileResult>;
  /** Optional file listing seam for dynamic source resolution. */
  listAllFiles?(context: RuntimeSandboxContext): Promise<readonly string[]>;
}