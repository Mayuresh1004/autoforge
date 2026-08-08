/**
 * ManagerSourceReader — the Engineer's bounded source reader. Reads a file
 * from the runtime sandbox through the EXISTING SandboxManager.execute seam
 * (argv-only, allowlisted env, hard timeout). No Docker anywhere in the
 * Engineer: everything funnels through the manager port.
 *
 * Protocol (argv-only, no shell, no pipes):
 *   1. `wc -c -- <path>`  → fail-fast when the file exceeds maxBytes
 *   2. `cat -- <path>`    → read the (bounded) file
 *   3. line window + truncation applied client-side
 *
 * Paths are validated with repo-path rules before any exec happens.
 */

import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';
import type { SandboxManager } from '../../../sandbox/domain/ports/sandbox-manager';
import { EngineerSourceError } from '../../domain/errors/engineer.errors';
import { isSupportedCodeFile, normalizeRepoPath } from '../../domain/models/repo-path';
import type { EngineerSourceReader, SourceReadRequest, SourceReadResult } from '../../domain/ports/source-reader';

export interface SourceReadBounds {
  readonly maxSourceBytes: number;
  readonly maxContextLines: number;
}

export class ManagerSourceReader implements EngineerSourceReader {
  constructor(
    private readonly sandboxes: SandboxManager,
    private readonly bounds: SourceReadBounds,
  ) {}

  async read(context: RuntimeSandboxContext, request: SourceReadRequest): Promise<SourceReadResult> {
    const path = normalizeRepoPath(request.path);
    if (path === '' || path === null) {
      throw new EngineerSourceError('SOURCE_INVALID_PATH', `invalid repository path: ${JSON.stringify(request.path)}`);
    }
    if (!isSupportedCodeFile(path)) {
      throw new EngineerSourceError('SOURCE_INVALID_PATH', `unsupported file type for source reading: ${path}`);
    }

    const maxBytes = request.maxBytes ?? this.bounds.maxSourceBytes;
    const size = await this.probeSize(context.sandboxId, path);
    if (size > maxBytes) {
      throw new EngineerSourceError('SOURCE_TOO_LARGE', `source file ${path} is ${size} bytes (max ${maxBytes})`);
    }

    const content = await this.readFile(context.sandboxId, path);
    const allLines = splitLines(content);

    let start = request.startLine ?? 1;
    let end = request.endLine ?? allLines.length;
    start = Math.max(1, start);
    end = Math.min(allLines.length, Math.max(start, end));

    let lines = allLines.slice(start - 1, end);
    let truncated = false;
    if (lines.length > this.bounds.maxContextLines) {
      lines = lines.slice(0, this.bounds.maxContextLines);
      truncated = true;
    }

    return { filePath: path, lines, offset: start, truncated, byteLength: size };
  }

  private async probeSize(sandboxId: string, path: string): Promise<number> {
    const result = await this.sandboxes.execute(sandboxId, {
      argv: ['wc', '-c', '--', path],
      timeoutMs: 15_000,
    });
    this.assertOk(result, 'size probe failed');
    const match = result.stdout.trim().match(/^(\d+)/);
    if (!match) {
      throw new EngineerSourceError('SOURCE_UNAVAILABLE', `cannot determine size of ${path}`);
    }
    return Number(match[1]);
  }

  private async readFile(sandboxId: string, path: string): Promise<string> {
    const result = await this.sandboxes.execute(sandboxId, {
      argv: ['cat', '--', path],
      timeoutMs: 15_000,
    });
    this.assertOk(result, 'read failed');
    return result.stdout;
  }

  private assertOk(result: { exitCode: number | null; stderr: string; timedOut: boolean }, label: string): void {
    if (result.exitCode !== 0 || result.timedOut) {
      const reason = result.timedOut ? 'timed out' : `exit ${result.exitCode}`;
      const detail = result.stderr.trim().slice(0, 200);
      throw new EngineerSourceError('SOURCE_UNAVAILABLE', `${label} (${reason}${detail ? `: ${detail}` : ''})`);
    }
  }
}

function splitLines(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split('\n');
  // drop the trailing empty element produced by a final newline
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}