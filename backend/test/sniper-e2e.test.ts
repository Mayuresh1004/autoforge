import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

/**
 * Sniper Agent end-to-end verification (acceptance criteria):
 *
 *   real Postgres (ephemeral container + `prisma migrate deploy`)
 *   → real Planner (AttackPlanService + PlanEngine, persisted)
 *   → real Docker sandbox (hardened container, internal network)
 *     hosting an intentionally-vulnerable SQLite app + sqlmap
 *   → real DefaultSniperService (SQL injection verifier)
 *   → exploit CONFIRMED + persisted (Exploit / VerificationAttempt /
 *     ExploitEvidence rows).
 *
 * Gated on SNIPER_E2E=1 AND a working `docker`; the default suite stays
 * green on machines without Docker.
 */

const ENABLED = process.env.SNIPER_E2E === '1' && dockerAvailable();

const SCAN_ID = `scan_e2e_${Date.now()}`;
const PG_NAME = 'amass-sniper-e2e-pg';
let postgresUrl = '';
const IMAGE = 'amass/sniper-e2e-sqlmap:latest';
let appTmp: string | null = null;

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 10_000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function runDocker(args: readonly string[]): string {
  return execFileSync('docker', [...args], { timeout: 600_000, stdio: 'pipe', encoding: 'utf8' });
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

const DOCKERFILE = `FROM python:3.11-slim
COPY app.py /opt/app.py
`;

const VULNERABLE_APP = `import http.server, sqlite3, os
from urllib.parse import parse_qs, urlparse

DBP = '/tmp/vuln.db'
if os.path.exists(DBP): os.remove(DBP)
con = sqlite3.connect(DBP)
con.execute('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL)')
con.executemany('INSERT INTO products (name, price) VALUES (?,?)', [
  ('laptop', 1200.0), ('mouse', 25.0), ('monitor', 300.0)])
con.commit(); con.close()

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = (parse_qs(urlparse(self.path).query).get('q') or [''])[0]
        con = sqlite3.connect(DBP)
        try:
            # INTENTIONALLY VULNERABLE: unsanitized user input reaches SQL.
            rows = con.execute(f"SELECT name, price FROM products WHERE id = {q}").fetchall()
        except sqlite3.Error:
            rows = []
        finally:
            con.close()
        if rows:
            body = '<html><body>' + ''.join(f'<p>{n} {p}</p>' for n, p in rows) + '</body></html>'
        else:
            body = '<html><body><p>NOT FOUND</p></body></html>'
        data = body.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def log_message(self, *a): pass

http.server.ThreadingHTTPServer(('0.0.0.0', 8000), H).serve_forever()
`;

describe.skipIf(!ENABLED)('Sniper Agent — Docker + PostgreSQL end-to-end', () => {
  let prisma: import('@prisma/client').PrismaClient;
  let manager: import('../src/sandbox/domain/ports/sandbox-manager').SandboxManager;
  let service: import('../src/sniper/domain/ports/sniper-service').SniperService;
  let sandboxId: string;
  let plannedTargetId: string;

  beforeAll(async () => {
    // 1. Ephemeral PostgreSQL (dedicated container, dynamic host port).
    try {
      runDocker(['rm', '-f', PG_NAME]);
    } catch {
      /* not running */
    }
    runDocker([
      'run', '-d', '--rm', '--name', PG_NAME,
      '-e', 'POSTGRES_USER=amass', '-e', 'POSTGRES_PASSWORD=amass', '-e', 'POSTGRES_DB=amass_test',
      '-p', '127.0.0.1:0:5432', 'postgres:16-alpine',
    ]);
    const portOutput = runDocker(['port', PG_NAME, '5432']);
    const hostPort = portOutput.trim().split(':').pop()?.trim();
    if (!hostPort) {
      throw new Error(`Failed to resolve dynamically allocated host port for ${PG_NAME}: ${portOutput}`);
    }
    postgresUrl = `postgresql://amass:amass@127.0.0.1:${hostPort}/amass_test`;
    process.env.DATABASE_URL = postgresUrl;

    await pollReady(
      () => runDocker(['exec', PG_NAME, 'pg_isready', '-U', 'amass', '-d', 'amass_test']).includes('accepting'),
      60_000,
      'postgres ready'
    );

    // 2. Apply migrations through the real migration layer and ensure schema is fully synced.
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: postgresUrl },
      timeout: 180_000,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    execFileSync('npx', ['prisma', 'db', 'push', '--accept-data-loss'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: postgresUrl },
      timeout: 180_000,
      stdio: 'pipe',
      encoding: 'utf8',
    });

    // 3. Build the vulnerable-app + sqlmap image (self-contained Dockerfile).
    appTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-e2e-'));
    // The hardened sandbox drops CAP_DAC_OVERRIDE: the bind-mounted workspace
    // must be world-traversable or the container user cannot open it.
    await fs.chmod(appTmp, 0o755);
    await fs.writeFile(path.join(appTmp, 'Dockerfile'), DOCKERFILE);
    await fs.writeFile(path.join(appTmp, 'app.py'), VULNERABLE_APP);
    runDocker(['build', '-q', '-t', IMAGE, appTmp]);

    // 4. Real sandbox (Docker backend, internal network, hardened profile).
    const { SandboxManagerService } = await import('../src/sandbox/application/services/sandbox-manager.service');
    const { DockerSandboxBackend } = await import('../src/sandbox/infrastructure/docker/docker-sandbox-backend');
    const { MemorySandboxStore } = await import('../src/sandbox/infrastructure/store/memory-sandbox-store');
    manager = new SandboxManagerService({
      backend: new DockerSandboxBackend(),
      store: new MemorySandboxStore(),
    });
    const sandbox = await manager.createSandbox({
      scanId: SCAN_ID,
      type: 'runtime',
      repositoryPath: appTmp,
      image: IMAGE,
      egress: 'internal',
      memoryLimit: '1g',
      cpus: 1,
    });
    await manager.waitUntilReady(sandbox.id, 60_000);
    sandboxId = sandbox.id;

    // 5. Deploy the vulnerable app inside the sandbox and wait for it.
    await manager.copyFile(sandboxId, path.join(appTmp, 'app.py'), '/workspace/app.py');
    const started = await manager.execute(sandboxId, {
      argv: ['sh', '-c', 'setsid nohup python3 /workspace/app.py >/tmp/app.log 2>&1 </dev/null &'],
      timeoutMs: 15_000,
      envOverrides: { PYTHONDONTWRITEBYTECODE: '1' },
    });
    if (started.exitCode !== 0) throw new Error(`app start failed: ${started.stderr}`);
    await pollReady(
      async () => {
        const probe = await manager.execute(sandboxId, {
          argv: [
            'python3', '-c',
            'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8000/search?q=1", timeout=5)',
          ],
          timeoutMs: 10_000,
        });
        return probe.exitCode === 0;
      },
      60_000,
      'vulnerable app reachable'
    );

    // 6. Seed the real Postgres: scan, scout surface, static finding.
    const { prisma: db } = await import('../src/config/database');
    prisma = db;
    await prisma.scan.create({ data: { id: SCAN_ID, name: 'sniper e2e' } });
    const scout = await prisma.scoutScan.create({
      data: {
        scanId: SCAN_ID,
        targetUrl: 'http://127.0.0.1:8000/',
        status: 'COMPLETED',
        summary: { endpoints: 1 },
      },
    });
    await prisma.scoutAttackSurface.create({
      data: {
        scoutScanId: scout.id,
        url: 'http://127.0.0.1:8000/search?q=1',
        method: 'GET',
        parameters: ['q'],
        risk: 'HIGH',
        reachable: true,
        statusCode: 200,
      },
    });
    await prisma.scoutTechnology.create({
      data: { scoutScanId: scout.id, name: 'Python' },
    }).catch(() => undefined);
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

    // 7. Real planner → persisted planned target.
    const { AttackPlanService } = await import('../src/planner/application/services/attack-plan.service');
    const { PrismaPlanRepository } = await import('../src/planner/infrastructure/repository/prisma-plan-repository');
    const { PlanEngine } = await import('../src/planner/application/ranking/plan-engine');
    const planner = new AttackPlanService({
      repository: new PrismaPlanRepository(),
      engine: new PlanEngine(),
    });
    const plan = await planner.generate(SCAN_ID);
    const target = plan.targets.find((t) => t.endpoint.includes('/search'));
    expect(target, 'planner produced a /search target').toBeDefined();
    plannedTargetId = target!.targetId;

    // 8. Real Sniper service (real Prisma repository + docker manager).
    const { createSniperInfrastructure } = await import('../src/sniper/infrastructure/factory/sniper-factory');
    service = createSniperInfrastructure({ manager }).service;
  }, 600_000);

  it('confirms the SQL injection inside the sandbox and persists the PoC', async () => {
    // 1. Verify that the target container does NOT contain sqlmap
    const checkTarget = await manager.execute(sandboxId, {
      argv: ['which', 'sqlmap'],
      timeoutMs: 5_000,
    });
    expect(checkTarget.exitCode, 'target container must NOT contain sqlmap').not.toBe(0);

    // 2. Run Sniper service (which uses independent security-tool container via executeToolInNetwork)
    const report = await service.run({
      scanId: SCAN_ID,
      sandboxId,
      baseUrl: 'http://127.0.0.1:8000/',
      targetIds: [plannedTargetId],
      options: { concurrency: 1, maxAttempts: 1, timeoutMs: 240_000 },
    });

    expect(report.results).toHaveLength(1);
    const poc = report.results[0].exploit;
    expect(poc.status).toBe('CONFIRMED');
    expect(poc.confidence).not.toBeNull();
    expect(poc.confidence!).toBeGreaterThan(0.7);
    expect(poc.parameter).toBe('q');
    expect(poc.attacks).toBeGreaterThanOrEqual(1);

    // Persisted rows (final status + per-attempt rows are separate).
    const row = await prisma.exploit.findUnique({
      where: { id: poc.id },
      include: { attempts: true, evidence: true },
    });
    expect(row).not.toBeNull();
    expect(row!.status).toBe('CONFIRMED');
    expect(row!.scanId).toBe(SCAN_ID);
    expect(row!.attempts.length).toBeGreaterThanOrEqual(1);
    expect(row!.evidence.length).toBeGreaterThan(0);
    expect(row!.statusReason).toContain('confirmed');
  }, 300_000);

  afterAll(async () => {
    // Sandbox teardown (idempotent), then the ephemeral Postgres.
    if (manager && sandboxId) await manager.destroy(sandboxId).catch(() => undefined);
    // Disconnect the prisma engine BEFORE the container is removed so it
    // never observes a killed connection (avoids a spurious prisma:error).
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    try {
      runDocker(['rm', '-f', PG_NAME]);
    } catch {
      /* already gone */
    }
    if (appTmp) await fs.rm(appTmp, { recursive: true, force: true }).catch(() => undefined);
  }, 120_000);
});
