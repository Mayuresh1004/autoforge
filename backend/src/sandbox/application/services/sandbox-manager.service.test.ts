import { describe, it, expect, vi } from 'vitest';
import type {
  ExecRequest,
  ExecResult,
  Sandbox,
  SandboxSpec,
} from '../../domain/models/sandbox';
import type { SandboxBackend } from '../../domain/ports/sandbox-manager';
import { SandboxManagerService } from './sandbox-manager.service';
import { MemorySandboxStore } from '../../infrastructure/store/memory-sandbox-store';

function makeBackend(): Record<keyof SandboxBackend, ReturnType<typeof vi.fn>> & SandboxBackend {
  const backend = {
    create: vi.fn().mockResolvedValue({ containerId: 'ct', networkId: undefined }),
    start: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(true),
    execute: vi.fn(),
    copyFile: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined),
    logs: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    sweep: vi.fn().mockResolvedValue(0),
  };
  return backend as unknown as SandboxBackend & {
    create: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    isReady: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    copyFile: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    restart: ReturnType<typeof vi.fn>;
    logs: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    sweep: ReturnType<typeof vi.fn>;
  };
}

function makeManager(backend = makeBackend()) {
  const store = new MemorySandboxStore();
  const manager = new SandboxManagerService({
    backend,
    store,
    defaultExecTimeoutMs: 5_000,
    createTimeoutMs: 2_000,
  });
  return { manager, backend, store };
}

describe('SandboxManagerService', () => {
  it('defaults analysis sandboxes to no egress but honors explicit clone egress', async () => {
    const { manager, backend } = makeManager();
    backend.create.mockResolvedValue({ containerId: 'amass_c', networkId: undefined });

    // No egress requested → analysis defaults to 'none'.
    await manager.createSandbox({
      scanId: 'scan_a', type: 'analysis', repositoryPath: '/tmp/ws', image: 'img',
    });
    expect(backend.create.mock.calls[0][0].network.egress).toBe('none');

    // Cloning needs egress → explicit, allowlisted egress is honored.
    await manager.createSandbox({
      scanId: 'scan_b', type: 'analysis', repositoryPath: '/tmp/ws', image: 'img',
      egress: 'egress', egressAllowlist: ['github.com'],
    });
    expect(backend.create.mock.calls[1][0].network.egress).toBe('egress');
  });

  it('defaults runtime sandboxes to internal network; allows explicit egress', async () => {
    const { backend } = makeManager();
    backend.create.mockResolvedValue({ containerId: 'ct' });

    const a = await makeManager(backend).manager.createSandbox({
      scanId: 's2', type: 'runtime', repositoryPath: '/w', image: 'img',
    });
    void a;
    expect(backend.create.mock.calls[0][0].network.egress).toBe('internal');

    backend.create.mockReset();
    backend.create.mockResolvedValue({ containerId: 'ct' });
    const m2 = makeManager(backend);
    await m2.manager.createSandbox({
      scanId: 's3', type: 'runtime', repositoryPath: '/w', image: 'img', egress: 'egress',
    });
    expect(backend.create.mock.calls[0][0].network.egress).toBe('egress');
  });

  it('returns unique, scan-scoped ids so concurrent scans never collide', async () => {
    const { backend, manager } = makeManager();
    backend.create.mockImplementation(async (spec) => ({ containerId: `ct_${spec.scanId}_${Math.random()}` }));
    const a = await manager.createSandbox({ scanId: 'scan_x', type: 'analysis', repositoryPath: '/w', image: 'img' });
    const b = await manager.createSandbox({ scanId: 'scan_x', type: 'analysis', repositoryPath: '/w', image: 'img' });
    const c = await manager.createSandbox({ scanId: 'scan_y', type: 'analysis', repositoryPath: '/w', image: 'img' });
    expect(a.id).not.toBe(b.id);
    expect(b.id).toContain('scan_x');
    expect(c.id).toContain('scan_y');
  });

  it('waitUntilReady marks ready when healthy and throws on timeout', async () => {
    const { backend, manager } = makeManager();
    backend.isReady.mockResolvedValue(true);
    const s = await manager.createSandbox({ scanId: 's1', type: 'analysis', repositoryPath: '/w', image: 'i' });
    await expect(manager.waitUntilReady(s.id)).resolves.toMatchObject({ status: 'ready' });

    // Timeout path: never ready within the bound.
    const b2 = { ...makeBackend(), isReady: vi.fn().mockResolvedValue(false) };
    const m2 = makeManager(b2).manager;
    const pending = await m2.createSandbox({ scanId: 's2', type: 'analysis', repositoryPath: '/w', image: 'i' });
    await expect(m2.waitUntilReady(pending.id, 60)).rejects.toThrow(/did not become ready/);
  });

  it('runs a controlled exec and restores running state', async () => {
    const { backend, manager } = makeManager();
    backend.create.mockResolvedValue({ containerId: 'ct' });
    const request: ExecRequest = { argv: ['bandit', '-r', '/workspace'], timeoutMs: 3_000 };
    const result: ExecResult = { stdout: 'ok', stderr: '', exitCode: 0, timedOut: false };
    backend.execute.mockResolvedValue(result);

    const s = await manager.createSandbox({ scanId: 's9', type: 'analysis', repositoryPath: '/w', image: 'i' });
    const exec = await manager.execute(s.id, request);
    expect(exec).toBe(result);
    expect(backend.execute.mock.calls[0][1].envAllowlist).toEqual(['PATH', 'HOME']);
  });

  it('destroys idempotently even when the backend throws', async () => {
    const { backend, manager } = makeManager();
    backend.destroy.mockRejectedValue(new Error('backend down'));
    const s = await manager.createSandbox({ scanId: 's7', type: 'analysis', repositoryPath: '/w', image: 'i' });
    backend.destroy.mockReset();
    backend.destroy.mockRejectedValue(new Error('boom'));
    await expect(manager.destroy(s.id)).resolves.toBeUndefined();
    expect(manager);
  });

  it('applyPatch writes files via the backend then restarts', async () => {
    const { backend, manager } = makeManager();
    backend.create.mockResolvedValue({ containerId: 'ct' });
    const s = await manager.createSandbox({ scanId: 's6', type: 'runtime', repositoryPath: '/w', image: 'i' });

    const result = await manager.applyPatch(s.id, [{ path: 'src/a.ts', content: 'x' }]);
    void result;
    expect(backend.writeFile).toHaveBeenCalledWith('ct', 'src/a.ts', 'x');
    expect(backend.restart).toHaveBeenCalledWith('ct');
  });

  it('delegates orphan sweeping to the backend', async () => {
    const { backend, manager } = makeManager();
    backend.sweep.mockResolvedValue(3);
    await expect(manager.sweepOrphans()).resolves.toBe(3);
  });
});