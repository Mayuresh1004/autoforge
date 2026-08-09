/**
 * SandboxPatchApplier — deterministic, bounded application of an Engineer
 * diff INSIDE the disposable sandbox only. Throws PatchConflictError for
 * path/diff problems; the original repo is never touched.
 */

import { describe, expect, it } from 'vitest';
import { ProgrammedSandboxManager } from '../../../../test/helpers/programmed-sandbox-manager';
import { StubEngineerSourceReader } from '../../../../test/helpers/engineer-fakes';
import { SandboxPatchApplier } from './patch-applier';
import { PatchConflictError } from '../../domain/errors/critic.errors';
import { criticPatch, CRITIC_BASE_SOURCE, CRITIC_PATCHED_SOURCE } from '../../../../test/helpers/critic-fakes';
import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';

const CONTEXT: RuntimeSandboxContext = {
  id: 'run-1',
  scanId: 'scan-1',
  sandboxId: 'sbx-1',
  targetUrl: 'http://127.0.0.1:8000',
} as RuntimeSandboxContext;

const BOUNDS = { maxPatchBytes: 4_000, maxSourceBytes: 8_000 };

function makeApplier(manager: ProgrammedSandboxManager, reader: StubEngineerSourceReader) {
  return new SandboxPatchApplier(manager, reader, BOUNDS);
}

describe('SandboxPatchApplier', () => {
  it('applies a valid patch by writing the patched content via the manager', async () => {
    const manager = new ProgrammedSandboxManager();
    const reader = new StubEngineerSourceReader({ 'src/app.py': CRITIC_BASE_SOURCE });
    const applier = makeApplier(manager, reader);
    manager.applyPatch = async () => manager.getSandbox('sbx-1')!;

    const info = await applier.apply(CONTEXT, criticPatch());

    expect(info.filePath).toBe('src/app.py');
    expect(info.patchedContent).toContain('cur.execute("SELECT * FROM users WHERE id = %s", (user_input,))');
  });

  it('rejects absolute paths before any read', async () => {
    const manager = new ProgrammedSandboxManager();
    const reader = new StubEngineerSourceReader();
    const applier = makeApplier(manager, reader);
    await expect(applier.apply(CONTEXT, criticPatch({ filePath: '/etc/passwd' }))).rejects.toBeInstanceOf(PatchConflictError);
  });

  it('rejects traversal paths before any read', async () => {
    const manager = new ProgrammedSandboxManager();
    const reader = new StubEngineerSourceReader();
    const applier = makeApplier(manager, reader);
    await expect(applier.apply(CONTEXT, criticPatch({ filePath: '../secrets.txt' }))).rejects.toBeInstanceOf(PatchConflictError);
  });

  it('rejects oversized diffs', async () => {
    const manager = new ProgrammedSandboxManager();
    const reader = new StubEngineerSourceReader();
    const applier = makeApplier(manager, reader);
    const big = 'x'.repeat(5_000);
    await expect(applier.apply(CONTEXT, criticPatch({ diffContent: big }))).rejects.toBeInstanceOf(PatchConflictError);
  });

  it('rejects a diff that does not apply cleanly (no fuzz)', async () => {
    const manager = new ProgrammedSandboxManager();
    const reader = new StubEngineerSourceReader({ 'src/app.py': 'totally different file\n' });
    const applier = makeApplier(manager, reader);
    await expect(applier.apply(CONTEXT, criticPatch())).rejects.toBeInstanceOf(PatchConflictError);
  });

  it('never invokes the manager when the diff is rejected', async () => {
    const manager = new ProgrammedSandboxManager();
    const reader = new StubEngineerSourceReader({ 'src/app.py': 'other\n' });
    const applier = makeApplier(manager, reader);
    manager.applyPatch = async () => {
      throw new Error('must not be called');
    };
    await expect(applier.apply(CONTEXT, criticPatch())).rejects.toBeInstanceOf(PatchConflictError);
  });
});