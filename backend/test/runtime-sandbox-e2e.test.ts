/**
 * Phase 6 E2E (gated on RUNTIME_SANDBOX_E2E=1 + docker): Repository →
 * RuntimeSandbox READY (Mode 2 build, internal net, TCP+HTTP health) → live
 * Scout → Planner → Sniper (sqlmap, sibling toolbox sandbox) → CONFIRMED
 * persisted → destroy with zero leftovers. Also Mode 1, failure cleanup,
 * expiration. Uses a dedicated PG on :15432 — never touches the dev compose
 * database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RUNTIME_E2E_ENABLED as ENABLED,
  RUNTIME_E2E_POSTGRES_URL as POSTGRES_URL,
  RUNTIME_E2E_PG_NAME as PG_NAME,
  RUNTIME_E2E_SCAN_ID as SCAN_ID,
  RUNTIME_E2E_TB_IMAGE as TB_IMAGE,
  VULNERABLE_APP,
  TOOLBOX_DOCKERFILE,
  RUNTIME_IMAGE_LABEL,
  pollReady,
  runDocker,
} from './helpers/runtime-e2e-fixture';

/** Remove every amass-managed container/network/image (best-effort). */
function sweepAmass(): void {
  for (const id of runDocker(['ps', '-aq', '--filter', 'label=amass.manager=1']).trim().split(/\s+/).filter(Boolean)) {
    runDocker(['rm', '-f', id], 60_000);
  }
  for (const net of runDocker(['network', 'ls', '-q', '--filter', 'label=amass.manager=1']).trim().split(/\s+/).filter(Boolean)) {
    runDocker(['network', 'rm', net], 60_000);
  }
  for (const img of runDocker(['images', '-q', '--filter', 'label=amass.manager=1']).trim().split(/\s+/).filter(Boolean)) {
    runDocker(['rmi', '-f', img], 60_000);
  }
}

describe.skipIf(!ENABLED)('Runtime Sandbox Lifecycle — Docker + PostgreSQL end-to-end', () => {
  let prisma!: import('@prisma/client').PrismaClient;
  let manager!: import('../src/sandbox/domain/ports/sandbox-manager').SandboxManager;
  let service!: import('../src/sandbox/domain/ports/runtime-sandbox-service').RuntimeSandboxService;
  let runtimeDir!: string;
  let runtimeId!: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = POSTGRES_URL;

    // 0. Start clean (no residue from previous/aborted runs).
    sweepAmass();

    // 1. Ephemeral PostgreSQL.
    try {
      runDocker(['rm', '-f', PG_NAME], 30_000);
    } catch {
      /* not running */
    }
    runDocker([
      'run', '-d', '--rm', '--name', PG_NAME,
      '-e', 'POSTGRES_USER=amass', '-e', 'POSTGRES_PASSWORD=amass', '-e', 'POSTGRES_DB=amass_test',
      '-p', '127.0.0.1:15432:5432', 'postgres:16-alpine',
    ], 120_000);
    await pollReady(
      () => runDocker(['exec', PG_NAME, 'pg_isready', '-U', 'amass', '-d', 'amass_test'], 30_000).includes('accepting'),
      60_000,
      'postgres ready'
    );
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: POSTGRES_URL },
      timeout: 180_000,
      stdio: 'pipe',
      encoding: 'utf8',
    });

    // 2. Toolbox image (sqlmap) — the only image the test builds directly.
    const toolboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-toolbox-'));
    await fs.writeFile(path.join(toolboxDir, 'Dockerfile'), TOOLBOX_DOCKERFILE);
    runDocker(['build', '-q', '-t', TB_IMAGE, toolboxDir], 900_000);

    // 3. Vulnerable-app repository (NO Dockerfile → Mode 2 generated build).
    runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-runtime-repo-'));
    await fs.chmod(runtimeDir, 0o755);
    await fs.writeFile(path.join(runtimeDir, 'app.py'), VULNERABLE_APP);

    // 4. Real runtime lifecycle stack.
    const { prisma: db } = await import('../src/config/database');
    prisma = db;
    await prisma.scan.create({ data: { id: SCAN_ID, name: 'runtime e2e' } });

    const { SandboxManagerService } = await import('../src/sandbox/application/services/sandbox-manager.service');
    const { DockerSandboxBackend } = await import('../src/sandbox/infrastructure/docker/docker-sandbox-backend');
    const { MemorySandboxStore } = await import('../src/sandbox/infrastructure/store/memory-sandbox-store');
    manager = new SandboxManagerService({
      backend: new DockerSandboxBackend(),
      store: new MemorySandboxStore(),
    });

    const { DefaultRuntimeSandboxService } = await import('../src/sandbox/application/services/runtime-sandbox.service');
    const { PrismaRuntimeSandboxRepository } = await import('../src/sandbox/infrastructure/repositories/prisma-runtime-sandbox-repository');
    const { MemoryRuntimeSandboxRegistry } = await import('../src/sandbox/infrastructure/registry/memory-runtime-registry');
    const { TcpHttpHealthProber } = await import('../src/sandbox/infrastructure/health/tcp-http-health-prober');
    const { PrismaRuntimeScanGateway } = await import('../src/sandbox/infrastructure/repositories/prisma-runtime-scan-gateway');
    const { FsRuntimeWorkspaceProvider } = await import('../src/sandbox/infrastructure/workspace/fs-runtime-workspace-provider');
    const { GitRepositoryCloner } = await import('../src/repository-analysis/infrastructure/git/git-repository-cloner');
    const { runtimeSandboxConfig } = await import('../src/config');
    service = new DefaultRuntimeSandboxService({
      manager,
      store: new PrismaRuntimeSandboxRepository(prisma),
      registry: new MemoryRuntimeSandboxRegistry(),
      prober: new TcpHttpHealthProber(),
      gateway: new PrismaRuntimeScanGateway(prisma),
      workspace: new FsRuntimeWorkspaceProvider(new GitRepositoryCloner()),
      config: runtimeSandboxConfig,
    });
  }, 900_000);

  afterAll(async () => {
    if (runtimeId) await service.destroy(runtimeId).catch(() => undefined);
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    try {
      runDocker(['rm', '-f', PG_NAME], 30_000);
    } catch {
      /* already gone */
    }
    // Hard sweep: this suite must never leak containers/networks/images.
    sweepAmass();
  }, 60_000);

  it('Repository → READY runtime sandbox → Scout → Planner → Sniper CONFIRMED → destroy', async () => {
    let toolSandboxId: string | null = null;
    try {
    const sandbox = await service.create({
      scanId: SCAN_ID,
      repository: { path: runtimeDir },
      name: 'e2e vulnerable app',
    });
    expect(sandbox.status).toBe('READY');
    expect(sandbox.imageName).toMatch(/^amass-rt-/);
    expect(sandbox.internalHost).toBeTruthy();
    expect(sandbox.targetUrl).toMatch(/^http:\/\//);
    runtimeId = sandbox.id;

    // Reachable inside the AMASS env: HTTP 200 from the host process now.
    await pollReady(async () => {
      const res = await fetch(`${sandbox.targetUrl}/search?q=1`).catch(() => null);
      return res !== null && res.status === 200;
    }, 30_000, 'vulnerable app answering on the sandbox network');

    // --- Scout (live recon) -----------------------------------------------
    const { createScoutService } = await import('../src/scout/infrastructure/factory/scout-factory');
    const scout = createScoutService();
    const report = await scout.run({
      scanId: SCAN_ID,
      targetUrl: sandbox.targetUrl,
      options: { timeoutMs: 60_000, maxPages: 20, maxDepth: 2, probeCommonPaths: false },
    });
    const searchSurface = report.attackSurface.find((e) => e.url.includes('/search'));
    expect(searchSurface, 'scout discovered /search on the runtime app').toBeDefined();

    // Seed the static correlation finding (planner input).
    await prisma.vulnerability.create({
      data: {
        scanId: SCAN_ID,
        title: 'SQL injection in search endpoint',
        severity: 'HIGH',
        vulnType: 'sqli',
        cweId: 'CWE-89',
        scanner: 'semgrep',
        confidence: 0.95,
        message: 'unsafe string interpolation into SQL query',
      },
    });

    // --- Planner -----------------------------------------------------------
    const { AttackPlanService } = await import('../src/planner/application/services/attack-plan.service');
    const { PrismaPlanRepository } = await import('../src/planner/infrastructure/repository/prisma-plan-repository');
    const { PlanEngine } = await import('../src/planner/application/ranking/plan-engine');
    const planner = new AttackPlanService({ repository: new PrismaPlanRepository(), engine: new PlanEngine() });
    const plan = await planner.generate(SCAN_ID);
    const target = plan.targets.find((t) => t.endpoint.includes('/search'));
    expect(target, 'planner produced a /search target').toBeDefined();
    // --- Sniper (sqlmap in a sibling toolbox sandbox on the same net) ----
    const toolSandbox = await manager.createSandbox({
      scanId: SCAN_ID,
      type: 'runtime',
      repositoryPath: runtimeDir,
      image: TB_IMAGE,
      egress: 'internal',
      mountRepository: false,
      memoryLimit: '1g',
      cpus: 1,
    });
    toolSandboxId = toolSandbox.id;
    await manager.waitUntilReady(toolSandbox.id, 60_000);

    const { createSniperInfrastructure } = await import('../src/sniper/infrastructure/factory/sniper-factory');
    const sniper = createSniperInfrastructure({ manager }).service;
    const report2 = await sniper.run({
      scanId: SCAN_ID,
      sandboxId: toolSandbox.id,
      baseUrl: `${sandbox.targetUrl}/`,
      targetIds: [target!.targetId],
      options: { concurrency: 1, maxAttempts: 1, timeoutMs: 600_000 },
    });
    expect(report2.results).toHaveLength(1);
    const poc = report2.results[0].exploit;
    expect(poc.status).toBe('CONFIRMED');
    expect(poc.parameter).toBe('q');
    const row = await prisma.exploit.findUnique({ where: { id: poc.id }, include: { evidence: true } });
    expect(row?.status).toBe('CONFIRMED');
    expect(row?.scanId).toBe(SCAN_ID);
    expect(row?.evidence.length).toBeGreaterThan(0);

    // --- Teardown: toolbox first, then the runtime sandbox ---------------
    await manager.destroy(toolSandbox.id);
    toolSandboxId = null;
    const destroyed = await service.destroy(runtimeId);
    expect(destroyed.status).toBe('DESTROYED');
    expect(destroyed.destroyedAt).toBeTruthy();
    } finally {
      // Guaranteed cleanup even when an assertion above fails.
      if (toolSandboxId) await manager.destroy(toolSandboxId).catch(() => undefined);
      if (runtimeId) await service.destroy(runtimeId).catch(() => undefined);

      // No orphaned containers / networks / images / workspaces.
      expect(runDocker(['ps', '-aq', '--filter', 'label=amass.manager=1']).trim()).toBe('');
      const nets = runDocker(['network', 'ls', '-q', '--filter', 'label=amass.manager=1']).split(/\s+/).filter(Boolean);
      expect(nets).not.toContain(`amass-net-${SCAN_ID}`);
      const rtImages = runDocker(['images', '-q', '--filter', `label=${RUNTIME_IMAGE_LABEL}`]).trim();
      expect(rtImages).toBe('');

      // Durable record reflects the terminal state + workspace reclaimed.
      if (runtimeId) {
        const persisted = await prisma.runtimeSandbox.findUnique({ where: { id: runtimeId } });
        expect(persisted?.status).toBe('DESTROYED');
        if (persisted?.workspacePath) {
          const ws = await fs.stat(persisted.workspacePath).catch(() => null);
          expect(ws).toBeNull();
        }
      }
    }
  }, 900_000);

  it('Mode 1 (repo Dockerfile) works and unsupported-mode failures leave nothing behind', async () => {
    const scan2 = 'scan_e2e_mode1';
    await prisma.scan.create({ data: { id: scan2, name: 'mode1' } });

    // Mode 1: repo-owned Dockerfile drives the build strategy.
    const mode1 = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-mode1-'));
    await fs.writeFile(
      path.join(mode1, 'Dockerfile'),
      'FROM python:3.11-slim\nCOPY app.py /app.py\nCMD ["python", "/app.py"]\n'
    );
    await fs.writeFile(path.join(mode1, 'app.py'), VULNERABLE_APP);
    const s1 = await service.create({ scanId: scan2, repository: { path: mode1 }, portOverride: 8000 });
    expect(s1.status).toBe('READY');
    expect(s1.imageName).toMatch(/^amass-rt-/);
    await service.destroy(s1.id);

    // Unsupported runtime (no Dockerfile, no python/node entrypoint) → FAILED.
    const junk = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-junk-'));
    await fs.writeFile(path.join(junk, 'main.rs'), 'fn main() {}\n');
    await expect(service.create({ scanId: scan2, repository: { path: junk } })).rejects.toThrow();
    const jRow = await prisma.runtimeSandbox.findFirst({
      where: { scanId: scan2, failureStage: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    expect(jRow?.failureReason).toMatch(/unsupported runtime/i);
    expect(runDocker(['ps', '-aq', '--filter', 'label=amass.manager=1']).trim()).toBe('');
    expect(runDocker(['images', '-q', '--filter', `label=${RUNTIME_IMAGE_LABEL}`]).trim()).toBe('');
  }, 900_000);

  it('expiration reclaims a timed-out sandbox', async () => {
    const scan3 = 'scan_e2e_expire';
    await prisma.scan.create({ data: { id: scan3, name: 'expire' } });
    const s3 = await service.create({ scanId: scan3, repository: { path: runtimeDir }, name: 'to expire' });
    expect(s3.status).toBe('READY');

    // Backdate the durable record so it looks expired, then sweep.
    await prisma.runtimeSandbox.update({
      where: { id: s3.id },
      data: { expiresAt: new Date(Date.now() - 60_000).toISOString() },
    });
    const freed = await service.cleanupExpired();
    expect(freed).toBeGreaterThanOrEqual(1);
    const gone = await prisma.runtimeSandbox.findUnique({ where: { id: s3.id } });
    expect(gone?.status).toBe('EXPIRED');
    expect(runDocker(['ps', '-aq', '--filter', 'label=amass.manager=1']).trim()).toBe('');
    expect(runDocker(['images', '-q', '--filter', `label=${RUNTIME_IMAGE_LABEL}`]).trim()).toBe('');
    const ws = await fs.stat(gone!.workspacePath!).catch(() => null);
    expect(ws).toBeNull();
  }, 600_000);
});
