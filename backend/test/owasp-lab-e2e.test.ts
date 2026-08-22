/**
 * End-to-end integration verification for OWASP Vuln Lab (npm workspace monorepo)
 * repository runtime provisioning & autonomous scan.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ENABLED = process.env.OWASP_E2E === '1' || process.env.ASKBIT_E2E === '1' || process.env.SNIPER_E2E === '1';
const PG_NAME = `amass-owasp-e2e-pg-${Date.now()}`;
const SCAN_ID = `scan_owasp_${Date.now()}`;
const OWASP_LAB_PATH = '/tmp/owasp-vuln-lab';

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

describe.skipIf(!ENABLED)('OWASP Vuln Lab Workspace Monorepo Scan E2E', () => {
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
    await prisma.scan.create({ data: { id: SCAN_ID, name: 'OWASP Vuln Lab E2E Scan' } });

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

  it('OWASP Vuln Lab repo -> runtime sandbox READY -> Scout -> Planner -> Sniper', async () => {
    // Stage 1: Runtime Sandbox Provisioning
    const sandbox = await runtimeService.create({
      scanId: SCAN_ID,
      repository: { path: OWASP_LAB_PATH },
      name: 'OWASP Vuln Lab Application',
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

    console.log('=== SCOUT DISCOVERED ATTACK SURFACE ===');
    for (const surface of scoutReport.attackSurface) {
      console.log(JSON.stringify({ method: surface.method, url: surface.url, parameters: surface.parameters, source: surface.source }));
    }

    // Assert Scout discovered real application endpoint and its parameters
    const productsSearch = scoutReport.attackSurface.find((e) => e.url.includes('/products/search'));
    expect(productsSearch, 'Scout must discover /products/search endpoint').toBeDefined();
    expect(productsSearch?.parameters, 'Scout must associate parameter q with /products/search').toContain('q');

    // Seed a static vulnerability finding for Planner
    await prisma.vulnerability.create({
      data: {
        scanId: SCAN_ID,
        title: 'SQL injection in OWASP Vuln Lab products search',
        severity: 'HIGH',
        vulnType: 'sqli',
        cweId: 'CWE-89',
        scanner: 'semgrep',
        confidence: 0.9,
        message: 'potential SQL injection parameter q in products search',
      },
    });

    // Stage 3: Planner
    const { AttackPlanService } = await import('../src/planner/application/services/attack-plan.service');
    const { PrismaPlanRepository } = await import('../src/planner/infrastructure/repository/prisma-plan-repository');
    const { PlanEngine } = await import('../src/planner/application/ranking/plan-engine');
    const planner = new AttackPlanService({ repository: new PrismaPlanRepository(), engine: new PlanEngine() });
    const plan = await planner.generate(SCAN_ID);
    expect(plan.targets.length).toBeGreaterThan(0);

    console.log('=== PLANNER GENERATED TARGETS ===');
    for (const t of plan.targets) {
      console.log(JSON.stringify({ endpoint: t.endpoint, method: t.method, hints: t.verificationHints }, null, 2));
    }

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

    console.log('=== SNIPER RESULTS ===');
    const sqliResults = sniperReport.results.filter((r) => r.exploit.type === 'SQL_INJECTION');
    for (const r of sqliResults) {
      console.log(JSON.stringify({
        endpoint: r.exploit.endpoint,
        method: r.exploit.method,
        status: r.exploit.status,
        parameter: r.exploit.parameter,
        reason: r.exploit.reason,
        evidence: r.exploit.evidence,
      }, null, 2));
    }

    const confirmedSqli = sqliResults.find((r) => r.exploit.status === 'CONFIRMED');
    expect(confirmedSqli, 'Vulnerable SQLi endpoint /api/products/search?q=laptop must reach CONFIRMED status').toBeDefined();
    expect(confirmedSqli?.exploit.parameter).toBe('q');

    // Stage 5: Engineer (Dynamic Source Resolution & Remediation Patch Generation)
    const { DefaultEngineerService } = await import('../src/engineer/application/services/engineer.service');
    const { PrismaConfirmedFindingRepository } = await import('../src/engineer/infrastructure/repositories/prisma-confirmed-finding-repository');
    const { PrismaEngineerPatchRepository } = await import('../src/engineer/infrastructure/repositories/prisma-patch-repository');
    const { ManagerSourceReader } = await import('../src/engineer/infrastructure/source/manager-source-reader');
    const { FileSystemPromptRegistry, resolvePromptsRoot } = await import('../src/prompts/infrastructure/fs-prompt-registry');
    const { DefaultAgentExecutionService } = await import('../src/agent/application/services/agent-execution.service');
    const { PrismaAgentExecutionRepository } = await import('../src/agent/infrastructure/repositories/prisma-agent-execution-repository');
    const { PrismaRuntimeSandboxRepository } = await import('../src/sandbox/infrastructure/repositories/prisma-runtime-sandbox-repository');
    const { ProgrammedLLMProvider } = await import('./helpers/engineer-fakes');

    const engineerLlm = new ProgrammedLLMProvider('fake/gemini-pro');
    engineerLlm.setText(JSON.stringify({
      vulnerabilityId: confirmedSqli!.exploit.vulnerabilityId!,
      status: 'GENERATED',
      filePath: 'server/routes/users.js',
      originalCode: "  const sql = `SELECT id, name, description, price FROM products WHERE name LIKE '%${q}%' OR description LIKE '%${q}%'`;\n  try {\n    const rows = db.prepare(sql).all();",
      patchedCode: "  const sql = `SELECT id, name, description, price FROM products WHERE name LIKE ? OR description LIKE ?`;\n  try {\n    const rows = db.prepare(sql).all(`%${q}%`, `%${q}%`);",
      explanation: 'Parameterized SQLite query with place-holders to neutralize SQL injection on parameter q',
      remediation: 'parameterized query',
      assumptions: [],
    }));

    const engineer = new DefaultEngineerService({
      findings: new PrismaConfirmedFindingRepository(prisma),
      patches: new PrismaEngineerPatchRepository(prisma),
      sourceReader: new ManagerSourceReader(manager, { maxSourceBytes: 1_000_000, maxContextLines: 100 }),
      rag: { search: async () => ({ documents: [] }) } as any,
      registry: new FileSystemPromptRegistry(resolvePromptsRoot(process.env.PROMPTS_ROOT)),
      llm: engineerLlm,
      executions: new DefaultAgentExecutionService(new PrismaAgentExecutionRepository(prisma)),
      runtimeStore: new PrismaRuntimeSandboxRepository(prisma),
    });

    const engineerResult = await engineer.run({ scanId: SCAN_ID, vulnerabilityId: confirmedSqli!.exploit.vulnerabilityId! });
    console.log('=== ENGINEER RESULT ===', JSON.stringify(engineerResult, null, 2));

    expect(engineerResult.status, 'Engineer must successfully generate a patch for the dynamically resolved source').toBe('GENERATED');
    expect(engineerResult.patchId, 'Engineer must produce a non-null patchId').toBeTruthy();

    const generatedPatch = await prisma.patch.findUnique({ where: { id: engineerResult.patchId! } });
    expect(generatedPatch, 'Patch record must exist in database').toBeDefined();
    expect(generatedPatch?.status).toBe('GENERATED');
    expect(generatedPatch?.filePath, 'Patch must point to resolved repository file').toBeTruthy();
    expect(generatedPatch?.diffContent, 'Patch must contain non-empty unified diff').toBeTruthy();
    expect(generatedPatch?.diffContent).toContain('--- a/');

    console.log('=== GENERATED PATCH DIFF ===');
    console.log(generatedPatch?.diffContent);

    // Stage 6: Critic (Patch validation)
    const { createCriticInfrastructure } = await import('../src/critic/infrastructure/factory/critic-factory');
    const criticInfra = createCriticInfrastructure({
      prisma,
      runtimeService,
      manager,
      sniper,
      registry: new FileSystemPromptRegistry(resolvePromptsRoot(process.env.PROMPTS_ROOT)),
      llm: engineerLlm,
      executions: new DefaultAgentExecutionService(new PrismaAgentExecutionRepository(prisma)),
      engineer,
      config: { maxPatchBytes: 100_000, maxSourceBytes: 1_000_000, checkTimeoutMs: 30_000, testTimeoutMs: 60_000, retestTimeoutMs: 60_000, advisoryEnabled: false, maxEngineerRetries: 1 },
    });

    const criticRun = await criticInfra.critic.run({ patchId: generatedPatch!.id });
    console.log('=== CRITIC RUN RESULT ===', JSON.stringify(criticRun, null, 2));
    expect(criticRun, 'Critic must complete validation run').toBeDefined();

    // Stage 7: Remediation Delivery (Pull Request creation with mocked gateway)
    const { RemediationDeliveryService } = await import('../src/remediation/application/services/remediation-delivery.service');
    const mockDeliveryGateway = {
      createPullRequest: async (input: any) => ({
        prNumber: 42,
        prUrl: `https://github.com/Mayuresh1004/owasp-vuln-lab/pull/42`,
        commitSha: 'e2e-commit-sha-123',
        headBranch: input.headBranch,
        prStatus: 'OPEN',
      }),
    };

    const deliveryService = new RemediationDeliveryService({
      prisma,
      gateway: mockDeliveryGateway,
    });

    const deliveryResult = await deliveryService.deliver({ scanId: SCAN_ID, patchId: generatedPatch!.id });
    console.log('=== REMEDIATION DELIVERY RESULT ===', JSON.stringify(deliveryResult, null, 2));

    expect(deliveryResult.status, 'Remediation Delivery must succeed for APPROVED patch').toBe('DELIVERED');
    expect(deliveryResult.prNumber).toBe(42);
    expect(deliveryResult.prUrl).toContain('Mayuresh1004/owasp-vuln-lab');

    const deliveredPatch = await prisma.patch.findUnique({ where: { id: generatedPatch!.id } });
    expect(deliveredPatch?.prNumber).toBe(42);
    expect(deliveredPatch?.prBranch).toBe(`amass/remediation/${generatedPatch!.id}`);
    expect(deliveredPatch?.status, 'Patch status must remain APPROVED upon PR creation').toBe('APPROVED');

    // Cleanup runtime sandbox
    const destroyed = await runtimeService.destroy(sandbox.id);
    runtimeSandboxId = null;
    expect(destroyed.status).toBe('DESTROYED');
  }, 900_000);
});
