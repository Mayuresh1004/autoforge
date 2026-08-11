import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { ProcessSandboxBackend } from './process-sandbox-backend';
import type { SandboxSpec } from '../domain/models/sandbox';

function spec(scanId = 'scan_1'): SandboxSpec {
  return {
    scanId,
    type: 'analysis',
    image: 'amass/analysis:test',
    repositoryPath: 'in-memory',
    network: { egress: 'none', allowlist: [] },
  };
}

const TMP_ROOT = path.join(os.tmpdir(), 'amass-backend-test');

describe('ProcessSandboxBackend (real, no-Docker manager backend)', () => {
  it('creates a throwaway workspace and executes commands inside it', async () => {
    const backend = new ProcessSandboxBackend({ workspaceRoot: TMP_ROOT });
    const { containerId, workspacePath } = await backend.create(spec());
    expect(workspacePath).toBeTruthy();
    expect(await backend.isReady(containerId)).toBe(true);

    // A real command runs with its cwd inside the workspace and sees the
    // file we wrote there earlier.
    await backend.writeFile(containerId, 'proof.txt', 'sandboxed\n');
    const exec = await backend.execute(containerId, {
      argv: ['cat', 'proof.txt'],
      cwd: workspacePath,
      timeoutMs: 10_000,
      network: 'none',
    });
    expect(exec.exitCode).toBe(0);
    expect(exec.stdout).toContain('sandboxed');
  });

  it('blocks paths that escape the sandbox workspace', async () => {
    const backend = new ProcessSandboxBackend({ workspaceRoot: TMP_ROOT });
    const { containerId, workspacePath } = await backend.create(spec());
    void workspacePath;
    await expect(
      backend.writeFile(containerId, '../../etc/evil', 'x')
    ).rejects.toThrow(/escapes sandbox workspace/);
    await expect(
      backend.copyFile(containerId, '.', '../../etc/evil')
    ).rejects.toThrow(/escapes sandbox workspace/);
  });

  it('destroy removes the workspace; sweep reclaims orphans', async () => {
    const backend = new ProcessSandboxBackend({ workspaceRoot: TMP_ROOT });
    const { containerId, workspacePath } = await backend.create(spec());

    // Simulate a crash: an orphan dir not tracked by the backend.
    const orphan = path.join(TMP_ROOT, `psbx_orphan_${Date.now()}`);
    await fs.mkdir(orphan, { recursive: true });

    await backend.destroy(containerId);
    await expect(fs.access(workspacePath)).rejects.toThrow(); // cleaned

    const swept = await backend.sweep();
    expect(swept).toBeGreaterThanOrEqual(1);
    await expect(fs.access(orphan)).rejects.toThrow(); // orphan reclaimed
  });

  it('network egress maps to the process run (egress→net, none blocked)', async () => {
    const backend = new ProcessSandboxBackend({ workspaceRoot: TMP_ROOT });
    const { containerId } = await backend.create(spec());
    const out = await backend.execute(containerId, {
      argv: ['true'],
      cwd: '/',
      timeoutMs: 5_000,
      network: 'egress',
    });
    expect(out.exitCode).toBe(0);
  });

  it('in-network health probes are Docker-only: process mode rejects them', async () => {
    const backend = new ProcessSandboxBackend({ workspaceRoot: TMP_ROOT });
    // No Docker network exists in process mode — in-network probing is
    // meaningless and must fail loudly, never silently return healthy.
    await expect(
      backend.probeNetworkHealth({
        networkId: 'amass-net-scan_1',
        host: '172.19.0.2',
        port: 8080,
        path: '/',
        timeoutMs: 5_000,
      })
    ).rejects.toThrow(/probeNetworkHealth/);
  });
});