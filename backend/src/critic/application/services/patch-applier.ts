/**
 * Critic patch applier — deterministic, bounded application of an Engineer
 * diff INSIDE the disposable validation sandbox only. Never touches the
 * original repository, never executes LLM text: the diff is parsed as data,
 * applied as data (writeFile via the EXISTING SandboxManager.applyPatch
 * seam), and the container restarts. Any context mismatch aborts as a
 * PATCH_CONFLICT before anything is written.
 */

import type { SandboxManager } from '../../../sandbox/domain/ports/sandbox-manager';
import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';
import type { EngineerSourceReader } from '../../../engineer/domain/ports/source-reader';
import { normalizeRepoPath } from '../../../engineer/domain/models/repo-path';
import { EngineerSourceError } from '../../../engineer/domain/errors/engineer.errors';
import { PatchConflictError } from '../../domain/errors/critic.errors';
import type { ReviewablePatch } from '../../domain/ports/patch-review-repository';
import { applyUnifiedDiff } from './apply-unified-diff';

export interface PatchApplierBounds {
  /** Max accepted diff size in chars (bounded). */
  readonly maxPatchBytes: number;
  /** Max source file bytes read for the diff base. */
  readonly maxSourceBytes: number;
}

export interface AppliedPatchInfo {
  readonly filePath: string;
  /** Resulting file content (bounded, used for the security gate). */
  readonly patchedContent: string;
  readonly diffChars: number;
}

export class SandboxPatchApplier {
  constructor(
    private readonly sandboxes: SandboxManager,
    private readonly reader: EngineerSourceReader,
    private readonly bounds: PatchApplierBounds,
  ) {}

  /**
   * Apply `patch` into `context.sandboxId`. Throws PatchConflictError for
   * path/diff problems and EngineerSourceError for infra issues.
   */
  async apply(
    context: RuntimeSandboxContext,
    patch: ReviewablePatch,
  ): Promise<AppliedPatchInfo> {
    if (!patch.filePath || patch.diffContent === null || patch.diffContent.length === 0) {
      throw new PatchConflictError('patch has no diff content to apply');
    }

    // 1. path re-validation (absolute/traversal/unsupported -> reject)
    const filePath = normalizeRepoPath(patch.filePath);
    if (!filePath) {
      throw new PatchConflictError(`invalid patch path: ${patch.filePath}`);
    }

    // 2. bounded diff size
    if (patch.diffContent.length > this.bounds.maxPatchBytes) {
      throw new PatchConflictError(
        `patch diff exceeds ${this.bounds.maxPatchBytes} chars (${patch.diffContent.length})`,
      );
    }

    // 3. base content — the CURRENT sandbox copy of the file (bounded read)
    let base: string;
    try {
      const read = await this.reader.readWholeFile(context, {
        path: filePath,
        maxBytes: this.bounds.maxSourceBytes,
      });
      base = read.content;
    } catch (error) {
      if (error instanceof EngineerSourceError) {
        throw new PatchConflictError(`cannot read base file inside sandbox: ${error.message}`);
      }
      throw error;
    }

    // 4. deterministic diff application — any mismatch = conflict, no fuzz
    const applied = applyUnifiedDiff({ base, diff: patch.diffContent });
    if (!applied.ok) {
      throw new PatchConflictError(`patch does not apply cleanly: ${applied.reason}`);
    }

    // 5. write through the manager seam (only inside the sandbox container)
    await this.sandboxes.applyPatch(context.sandboxId, [
      { path: filePath, content: applied.content },
    ]);

    return { filePath, patchedContent: applied.content, diffChars: patch.diffContent.length };
  }
}