import { describe, expect, it, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RuntimeSandboxConfig } from '../../../config';
import { DefaultRuntimeSandboxService } from './runtime-sandbox.service';
import { MemoryRuntimeSandboxStore } from '../../../../test/helpers/memory-runtime-sandbox-store';
import { MemoryRuntimeSandboxRegistry } from '../../infrastructure/registry/memory-runtime-registry';
import { FakeHealthProber, FakeScanGateway, FakeWorkspaceProvider } from '../../../../test/helpers/runtime-test-fakes';
import { ProgrammedSandboxManager } from '../../../../test/helpers/programmed-sandbox-manager';
import {
  InvalidRuntimeRepositoryError,
  RuntimeSandboxCapacityError,
  RuntimeSandboxCreationError,
  RuntimeSandboxForbiddenError,
  RuntimeSandboxHostExposureDeniedError,
  RuntimeSandboxNotFoundError,
  UnsupportedRuntimeError,
} from '../../domain/errors/runtime-sandbox.errors';

const SCAN = 'scan-1';

function config(overrides: Partial<RuntimeSandboxConfig> = {}): RuntimeSandboxConfig {
  return {
    maxConcurrent: 3,
    lifetimeMs: 1_800_000,
    buildTimeoutMs: 300_000,
    startTimeoutMs: 60_000,
    healthTimeoutMs: 30_000,
    allowHostExpose: false,
    limits: { cpus: 0.5, memory: '512m', pids: 256 },
    ...overrides,
  };
}

async function makeHarness(
  overrides: Partial<RuntimeSandboxConfig> = {},
  gatewayOptions: { scanMissing?: boolean; relations?: Record<string, boolean | null> } = {}
) {
  const manager = new ProgrammedSandboxManager();
  const store = new MemoryRuntimeSandboxStore();
  const registry = new MemoryRuntimeSandboxRegistry();
  const prober = new FakeHealthProber();
  const gateway = new FakeScanGateway({
    missingScan: gatewayOptions.scanMissing ? 'missing' : 'exists',
    relations: gatewayOptions.relations,
  });
  const workspace = new FakeWorkspaceProvider();
  const service = new DefaultRuntimeSandboxService({
    manager,
    store,
    registry,
    prober,
    gateway,
    workspace,
    config: config(overrides),
  });
  return { manager, store, registry, prober, gateway, workspace, service };
}

async function pythonRepo(extra: Readonly<Record<string, string>> = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rt-svc-'));
  await fs.writeFile(path.join(dir, 'app.py'), 'print("hello")');
  for (const [name, content] of Object.entries(extra)) {
    await fs.writeFile(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

describe('DefaultRuntimeSandboxService (headless, no Docker)', () => {
  beforeEach(() => {
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  it('provisions a Python runtime sandbox to READY with hardened container options', async () => {
    const { manager, store, registry, workspace, service } = await makeHarness();
    const repo = await pythonRepo();

    process.env.AWS_SECRET_ACCESS_KEY = 'do-not-leak';
    const sandbox = await service.create({ scanId: SCAN, repository: { path: repo }, name: 'demo' });

    expect(sandbox.status).toBe('READY');
    expect(sandbox.scanId).toBe(SCAN);
    expect(sandbox.sandboxId).toMatch(/^sbx_/);
    expect(sandbox.imageName).toMatch(/^amass-rt-/);
    expect(sandbox.networkId).toBe(`amass-net-${SCAN}`);
    expect(sandbox.internalHost).toBe('172.19.0.10');
    expect(sandbox.internalPort).toBe(8000);
    expect(sandbox.targetUrl).toBe('http://172.19.0.10:8000');
    expect(sandbox.expiresAt).toBeTruthy();
    expect(sandbox.failureReason).toBeNull();

    // Hardened manager request: no host mount, internal network, bounded limits.
    const create = manager.createCalls[0];
    expect(create.type).toBe('runtime');
    expect(create.mountRepository).toBe(false);
    expect(create.egress).toBe('internal');
    expect(create.memoryLimit).toBe('512m');
    expect(create.cpus).toBe(0.5);
    expect(create.pidsLimit).toBe(256);
    expect(create.appCommand).toEqual([]);
    expect(create.hostPublishLocalhost).toBeUndefined();

    // Only the explicit env allowlist reaches the container.
    expect(create.env?.['PORT']).toBe('8000');
    expect(create.env?.['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    expect(Object.values(create.env ?? {})).not.toContain('do-not-leak');

    // Registry + durable store agree on one live sandbox.
    expect(await registry.countActive()).toBe(1);
    expect(await store.get(sandbox.id)).not.toBeNull();
    expect(workspace.cleaned).toHaveLength(0);
  });

  it('Mode 1: repository Dockerfile is what gets built', async () => {
    const { manager, service } = await makeHarness();
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'rt-svc-'));
    await fs.writeFile(path.join(repo, 'Dockerfile'), 'FROM scratch\n');

    const sandbox = await service.create({ scanId: SCAN, repository: { path: repo } });
    expect(sandbox.status).toBe('READY');
    // Mode 1 dockerfile is resolved against the build CONTEXT (never the CWD).
    expect(manager.buildCalls[0].dockerfilePath).toMatch(/\/Dockerfile$/);
  });

  it('Mode 2 generated Dockerfile lands in the build context', async () => {
    const { workspace, service } = await makeHarness();
    const repo = await pythonRepo({ 'requirements.txt': 'flask\n' });
    await service.create({ scanId: SCAN, repository: { path: repo } });

    expect(workspace.lastRepoPath).toBeTruthy();
    const generated = await fs.readFile(path.join(workspace.lastRepoPath!, 'Dockerfile'), 'utf8');
    expect(generated).toContain('pip install --no-cache-dir -r requirements.txt');
    expect(generated).toContain('CMD ["python", "app.py"]');
  });

  it('rejects unsupported runtimes and persists FAILED without touching Docker', async () => {
    const { manager, store, registry, service } = await makeHarness();
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'rt-svc-'));
    await fs.writeFile(path.join(repo, 'readme.md'), '# nothing to run\n');

    await expect(service.create({ scanId: SCAN, repository: { path: repo } })).rejects.toBeInstanceOf(
      UnsupportedRuntimeError
    );
    const failed = store.all().find((s) => s.status === 'FAILED');
    expect(failed?.failureStage).toBe('RUNTIME_DETECTION');
    expect(manager.createCalls).toHaveLength(0);
    expect(await registry.countActive()).toBe(0);
  });

  it('fails cleanly (FAILED + workspace reclaimed) when the image build fails', async () => {
    const { manager, store, workspace, service } = await makeHarness();
    manager.failBuild = true;
    const repo = await pythonRepo();

    await expect(service.create({ scanId: SCAN, repository: { path: repo } })).rejects.toBeInstanceOf(
      RuntimeSandboxCreationError
    );
    const failed = store.all().find((s) => s.status === 'FAILED');
    expect(failed?.failureStage).toBe('IMAGE_BUILD');
    expect(workspace.cleaned).toHaveLength(1);
  });

  it('unhealthy app → FAILED + container, image and workspace all reclaimed', async () => {
    const { manager, store, registry, prober, workspace, service } = await makeHarness();
    prober.failHealth = true;
    const repo = await pythonRepo();

    await expect(service.create({ scanId: SCAN, repository: { path: repo } })).rejects.toBeInstanceOf(
      RuntimeSandboxCreationError
    );
    const failed = store.all().find((s) => s.status === 'FAILED');
    expect(failed?.failureStage).toBe('HEALTH_CHECK');
    expect(failed?.failureReason).toContain('health');
    expect(manager.destroyed).toContain(failed?.sandboxId);
    expect(manager.removedImages).toContain(failed?.imageId);
    expect(workspace.cleaned).toHaveLength(1);
    expect(await registry.countActive()).toBe(0);
  });

  it('workspace prep failure → FAILED with WORKSPACE stage, nothing else created', async () => {
    const harness = await makeHarness();
    harness.workspace.failPrepare = true;
    const repo = await pythonRepo();

    await expect(harness.service.create({ scanId: SCAN, repository: { path: repo } })).rejects.toBeInstanceOf(
      RuntimeSandboxCreationError
    );
    expect(harness.manager.createCalls).toHaveLength(0);
  });

  it('enforces the concurrency ceiling with a structured capacity error', async () => {
    const harness = await makeHarness({ maxConcurrent: 1 });
    const repo = await pythonRepo();
    await harness.service.create({ scanId: SCAN, repository: { path: repo } });

    const err = await harness.service
      .create({ scanId: 'scan-2', repository: { path: repo } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RuntimeSandboxCapacityError);
    expect((err as RuntimeSandboxCapacityError).active).toBe(1);
    expect((err as RuntimeSandboxCapacityError).max).toBe(1);
  });

  it('rejects a missing scan before touching any resource', async () => {
    const { manager, service } = await makeHarness({}, { scanMissing: true });
    const repo = await pythonRepo();
    await expect(service.create({ scanId: 'nope', repository: { path: repo } })).rejects.toBeInstanceOf(
      InvalidRuntimeRepositoryError
    );
    expect(manager.createCalls).toHaveLength(0);
  });

  it('get() enforces scan scoping and missing ids', async () => {
    const { service } = await makeHarness();
    const repo = await pythonRepo();
    const sandbox = await service.create({ scanId: SCAN, repository: { path: repo } });

    await expect(service.get(sandbox.id)).resolves.not.toBeNull();
    await expect(service.get(sandbox.id, { scanId: SCAN })).resolves.not.toBeNull();
    await expect(service.get(sandbox.id, { scanId: 'other-scan' })).rejects.toBeInstanceOf(
      RuntimeSandboxForbiddenError
    );
    await expect(service.get('missing')).rejects.toBeInstanceOf(RuntimeSandboxNotFoundError);
  });

  it('destroys idempotently, reclaiming resources exactly once', async () => {
    const { manager, registry, workspace, service } = await makeHarness();
    const repo = await pythonRepo();
    const sandbox = await service.create({ scanId: SCAN, repository: { path: repo } });

    const first = await service.destroy(sandbox.id);
    expect(first.status).toBe('DESTROYED');
    expect(first.destroyedAt).toBeTruthy();
    expect(manager.destroyed.length).toBeGreaterThan(0);
    expect(await registry.countActive()).toBe(0);
    const marks = [
      manager.destroyed.length,
      manager.removedImages.length,
      workspace.cleaned.length,
    ];

    const second = await service.destroy(sandbox.id);
    expect(second.status).toBe('DESTROYED');
    expect(manager.destroyed.length).toBe(marks[0]);
    expect(manager.removedImages.length).toBe(marks[1]);
    expect(workspace.cleaned.length).toBe(marks[2]);
  });

  it('expires timed-out sandboxes via cleanupExpired and frees the slot', async () => {
    const { store, manager, registry, service } = await makeHarness();
    const repo = await pythonRepo();
    const sandbox = await service.create({ scanId: SCAN, repository: { path: repo } });

    const current = await store.get(sandbox.id);
    expect(current).not.toBeNull();
    await store.save({
      ...(current as NonNullable<typeof current>),
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });

    const reclaimed = await service.cleanupExpired();
    expect(reclaimed).toBeGreaterThanOrEqual(1);
    expect((await store.get(sandbox.id))?.status).toBe('EXPIRED');
    expect(manager.destroyed).toContain(sandbox.sandboxId);
    expect(await registry.countActive()).toBe(0);
  });

  it('healthCheck re-verifies a READY sandbox', async () => {
    const { prober, service } = await makeHarness();
    prober.result = { reachable: true, latencyMs: 12, statusCode: 200 };
    const repo = await pythonRepo();
    const sandbox = await service.create({ scanId: SCAN, repository: { path: repo } });

    const ok = await service.healthCheck(sandbox.id);
    expect(ok.ok).toBe(true);
    expect(ok.statusCode).toBe(200);
    expect(prober.probes.length).toBeGreaterThanOrEqual(2);
  });

  it('two concurrent sandboxes stay isolated with distinct ids', async () => {
    const { registry, service } = await makeHarness();
    const repo = await pythonRepo();
    const [a, b] = await Promise.all([
      service.create({ scanId: 'scan-a', repository: { path: repo } }),
      service.create({ scanId: 'scan-b', repository: { path: repo } }),
    ]);
    expect(a.status).toBe('READY');
    expect(b.status).toBe('READY');
    expect(a.id).not.toBe(b.id);
    expect(a.scanId).toBe('scan-a');
    expect(b.scanId).toBe('scan-b');
    expect(await registry.countActive()).toBe(2);
  });

  it('host-exposed sandbox targets 127.0.0.1 for probes and URL', async () => {
    const { manager, prober, service } = await makeHarness({ allowHostExpose: true });
    manager.createError = { exposedPort: 49001 };
    const repo = await pythonRepo();

    const sandbox = await service.create({ scanId: SCAN, repository: { path: repo }, hostExpose: true });
    expect(sandbox.exposedPort).toBe(49001);
    expect(sandbox.targetUrl).toBe('http://127.0.0.1:49001');
    const lastProbe = prober.probes[prober.probes.length - 1];
    expect(lastProbe.request.host).toBe('127.0.0.1');
    expect(lastProbe.request.port).toBe(49001);
  });

  it('fails fast with a typed error when hostExpose is denied by config', async () => {
    // allowHostExpose defaults to false (secure default) — never silently
    // dropped, never silently probed from an unreachable internal address.
    const { manager, store, service } = await makeHarness({ allowHostExpose: false });
    const repo = await pythonRepo();

    await expect(
      service.create({ scanId: SCAN, repository: { path: repo }, hostExpose: true })
    ).rejects.toBeInstanceOf(RuntimeSandboxHostExposureDeniedError);
    // No provisioning side effects at all: no image, no container, no record.
    expect(manager.buildCalls).toHaveLength(0);
    expect(manager.createCalls).toHaveLength(0);
    expect(store.all().length).toBe(0);
  });

  it('allows hostExpose when allowHostExpose is enabled', async () => {
    const { manager, store, service } = await makeHarness({ allowHostExpose: true });
    manager.createError = { exposedPort: 49001 };
    const repo = await pythonRepo();

    const sandbox = await service.create({ scanId: SCAN, repository: { path: repo }, hostExpose: true });
    expect(sandbox.status).toBe('READY');
    expect(sandbox.exposedPort).toBe(49001);
    expect(manager.createCalls.length).toBe(1);
    expect(store.all().length).toBeGreaterThan(0);
  });
});