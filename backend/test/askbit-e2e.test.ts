/**
 * End-to-end integration verification for AskBit repository runtime provisioning & autonomous scan.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ENABLED = process.env.ASKBIT_E2E === '1' || process.env.SNIPER_E2E === '1';
const PG_NAME = `amass-askbit-e2e-pg-${Date.now()}`;
const SCAN_ID = `scan_askbit_${Date.now()}`;
const ASKBIT_PATH = '/tmp/askbit-test';

function runDocker(args: readonly string[], timeout = 120_000): string {
  return execFileSync('docker', [...args], { timeout, stdio: 'pipe', encoding: 'utf8' });
}

async function pollReady(probe: () => boolean | Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`timeout waiting for ${label}`);
}

describe.skipIf(!ENABLED)('AskBit Autonomous Scan E2E', () => {
  let prisma: import('@prisma/client').PrismaClient;
  let manager: import('../src/sandbox/domain/ports/sandbox-manager').SandboxManager;
  let runtimeService: import('../src/sandbox/domain/ports/runtime-sandbox-service').RuntimeSandboxService;
  let runtimeSandboxId: string | null = null;
  let hostPortResolved: string | undefined;

  beforeAll(async () => {
    // 1. Ephemeral PostgreSQL
    try {
      runDocker(['rm', '-f', PG_NAME]);
    } catch {}
    runDocker([
      'run', '-d', '--rm', '--name', PG_NAME,
      '-e', 'POSTGRES_USER=amass', '-e', 'POSTGRES_PASSWORD=amass', '-e', 'POSTGRES_DB=amass_test',
      '-p', '127.0.0.1:0:5432', 'postgres:16-alpine',
    ]);
    const portOutput = runDocker(['port', PG_NAME, '5432']);
    hostPortResolved = portOutput.trim().split(':').pop()?.trim();
    const pgUrl = `postgresql://amass:amass@127.0.0.1:${hostPortResolved}/amass_test?schema=public`;
    process.env.DATABASE_URL = pgUrl;

    await pollReady(
      () => runDocker(['exec', PG_NAME, 'pg_isready', '-U', 'amass', '-d', 'amass_test'], 30_000).includes('accepting'),
      60_000,
      'postgres ready'
    );
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: pgUrl },
      timeout: 180_000,
      stdio: 'pipe',
      encoding: 'utf8',
    });

    const { prisma: db } = await import('../src/config/database');
    prisma = db;
    await prisma.scan.create({ data: { id: SCAN_ID, name: 'AskBit E2E Scan' } });

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
    runtimeService = new DefaultRuntimeSandboxService({
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
    if (runtimeSandboxId) await runtimeService.destroy(runtimeSandboxId).catch(() => undefined);
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    try {
      runDocker(['rm', '-f', PG_NAME]);
    } catch {}
  }, 60_000);

  it('AskBit Next.js repo -> runtime sandbox READY -> Scout -> Planner -> Sniper', async () => {
    // Stage 1: Runtime Sandbox Provisioning
    const sandbox = await runtimeService.create({
      scanId: SCAN_ID,
      repository: { path: ASKBIT_PATH },
      name: 'AskBit Next.js Application',
    });

    runtimeSandboxId = sandbox.id;
    expect(sandbox.status).toBe('READY');
    expect(sandbox.imageName).toMatch(/^amass-rt-/);
    expect(sandbox.targetUrl).toBeTruthy();

    // Stage 2: Scout (live recon)
    const { createScoutService } = await import('../src/scout/infrastructure/factory/scout-factory');
    const scout = createScoutService();
    const scoutReport = await scout.run({
      scanId: SCAN_ID,
      targetUrl: sandbox.targetUrl,
      options: { timeoutMs: 60_000, maxPages: 10, maxDepth: 2, probeCommonPaths: true },
    });
    expect(scoutReport.attackSurface.length).toBeGreaterThan(0);

    // Seed a vulnerability finding for Planner
    await prisma.vulnerability.create({
      data: {
        scanId: SCAN_ID,
        title: 'SQL injection in AskBit API',
        severity: 'HIGH',
        vulnType: 'sqli',
        cweId: 'CWE-89',
        scanner: 'semgrep',
        confidence: 0.9,
        message: 'potential SQL injection parameter',
      },
    });

    // Stage 3: Planner
    const { AttackPlanService } = await import('../src/planner/application/services/attack-plan.service');
    const { PrismaPlanRepository } = await import('../src/planner/infrastructure/repository/prisma-plan-repository');
    const { PlanEngine } = await import('../src/planner/application/ranking/plan-engine');
    const planner = new AttackPlanService({ repository: new PrismaPlanRepository(), engine: new PlanEngine() });
    const plan = await planner.generate(SCAN_ID);
    expect(plan.targets.length).toBeGreaterThan(0);

    // Stage 4: Sniper (Security tools execution)
    const { createSniperInfrastructure } = await import('../src/sniper/infrastructure/factory/sniper-factory');
    const sniper = createSniperInfrastructure({ manager }).service;
    const sniperReport = await sniper.run({
      scanId: SCAN_ID,
      sandboxId: sandbox.sandboxId!,
      baseUrl: `${sandbox.targetUrl}/`,
      targetIds: plan.targets.map((t) => t.targetId),
      options: { concurrency: 1, maxAttempts: 1, timeoutMs: 300_000 },
    });
    expect(sniperReport.results.length).toBe(plan.targets.length);

    // Cleanup runtime sandbox
    const destroyed = await runtimeService.destroy(sandbox.id);
    runtimeSandboxId = null;
    expect(destroyed.status).toBe('DESTROYED');
  }, 900_000);
});
