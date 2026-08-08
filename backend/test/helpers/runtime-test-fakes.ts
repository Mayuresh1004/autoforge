import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HealthProbeResult } from '../../src/sandbox/domain/value-objects/runtime-config';
import type {
  HealthProbeRequest,
  RuntimeHealthProber,
} from '../../src/sandbox/domain/ports/runtime-health-prober';
import type {
  PreparedWorkspace,
  RuntimeWorkspaceProvider,
} from '../../src/sandbox/domain/ports/runtime-workspace-provider';
import type { RuntimeRepositoryRef } from '../../src/sandbox/domain/entities/runtime-sandbox';
import type { RuntimeScanGateway } from '../../src/sandbox/domain/ports/runtime-scan-gateway';

/** Scriptable prober: default healthy; fail with `failNext` flags or `failures`. */
export class FakeHealthProber implements RuntimeHealthProber {
  probes: Array<{ request: HealthProbeRequest; startedAt: number }> = [];
  result: HealthProbeResult = { reachable: true, latencyMs: 3, statusCode: 200 };
  failHealth = false;

  async probe(request: HealthProbeRequest): Promise<HealthProbeResult> {
    this.probes.push({ request, startedAt: Date.now() });
    if (this.failHealth) {
      return { reachable: false, latencyMs: 1, detail: 'connection refused (fake)' };
    }
    return this.result;
  }
}

export interface FakeScanGatewayOptions {
  readonly relations?: Record<string, boolean | null>;
  readonly missingScan?: 'exists' | 'missing';
}

/** Configurable scan/repo gateway: which scans exist and own what. */
export class FakeScanGateway implements RuntimeScanGateway {
  private readonly relations: Record<string, boolean | null>;
  private readonly missingScan: 'exists' | 'missing';

  constructor(options: FakeScanGatewayOptions = {}) {
    this.relations = options.relations ?? {};
    this.missing = options.missingScan ?? 'exists';
  }

  async scanExists(scanId: string): Promise<boolean> {
    return this.missing === 'exists';
  }

  async scanRepositoryRelation(_scanId: string, repository: RuntimeRepositoryRef): Promise<boolean | null> {
    if (!repository.url) return null;
    return this.relations[repository.url] ?? null;
  }
}

export interface FakeWorkspaceHooks {
  readonly failPrepare?: boolean;
  readonly failCleanup?: boolean;
}

/**
 * Real-filesystem workspace provider for unit tests (fast, no Docker):
 * creates a temp dir and copies the requested local repo path into it.
 */
export class FakeWorkspaceProvider implements RuntimeWorkspaceProvider {
  cleaned: string[] = [];
  /** Last prepared paths (assertions). */
  lastWorkspacePath: string | null = null;
  lastRepoPath: string | null = null;
  /** Scriptable failure flags (tests toggle these). */
  failPrepare: boolean;
  failCleanup: boolean;

  constructor(hooks: FakeWorkspaceHooks = {}) {
    this.failPrepare = hooks.failPrepare ?? false;
    this.failCleanup = hooks.failCleanup ?? false;
  }

  async prepare(repository: RuntimeRepositoryRef): Promise<PreparedWorkspace> {
    if (this.failPrepare) throw new Error('workspace prepare failed (fake)');
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'rt-fake-'));
    this.lastWorkspacePath = workspacePath;
    if (repository.path) {
      const repoPath = path.join(workspacePath, 'repo');
      this.lastRepoPath = repoPath;
      await fs.cp(repository.path, repoPath, { recursive: true });
      return { workspacePath, repoPath };
    }
    const repoPath = path.join(workspacePath, 'repo');
    this.lastRepoPath = repoPath;
    await fs.mkdir(repoPath, { recursive: true });
    return { workspacePath, repoPath };
  }

  async cleanup(workspacePath: string): Promise<void> {
    if (this.failCleanup) throw new Error('workspace cleanup failed (fake)');
    this.cleaned.push(workspacePath);
    await fs.rm(workspacePath, { recursive: true, force: true });
  }
}

/** Config shared by the headless runtime service tests. */
export function runtimeTestConfig(overrides: Partial<Record<string, number | boolean>> = {}) {
  return {
    maxConcurrent: (overrides.maxConcurrent as number) ?? 3,
    lifetimeMs: 1_800_000,
    buildTimeoutMs: 300_000,
    startTimeoutMs: 60_000,
    healthTimeoutMs: 30_000,
    allowHostExpose: (overrides.allowHostExpose as boolean) ?? false,
    limits: { cpus: 0.5, memory: '512m', pids: 256 },
  };
}