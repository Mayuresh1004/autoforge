/**
 * Opt-in LIVE Critic E2E — real Docker end to end.
 *
 *   CRITIC_E2E=1 (requires a working local Docker daemon)
 *
 * Exercises the REAL Docker backend (image build, container create, real
 * health probing, real patch-file copy onto a fresh container, real
 * teardown) with the genuinely vulnerable app; the Sniper stays a stub
 * (real semantic verification lives in test/sniper-e2e.test.ts). Verdicts
 * and persistence use the real repositories of the pipeline.
 *
 * Zero residue: after the run no amass-managed container remains.
 * Skipped unless CRITIC_E2E=1.
 */

import { describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { DockerSandboxBackend } from '../src/sandbox/infrastructure/docker/docker-sandbox-backend';
import { SandboxManagerService } from '../src/sandbox/application/services/sandbox-manager.service';
import { MemorySandboxStore } from '../src/sandbox/infrastructure/store/memory-sandbox-store';
import { TcpHttpHealthProber } from '../src/sandbox/infrastructure/health/tcp-http-health-prober';
import type { SandboxManager } from '../src/sandbox/domain/ports/sandbox-manager';
import type { Sandbox } from '../src/sandbox/domain/models/sandbox';
import type { RuntimeSandbox } from '../src/sandbox/domain/entities/runtime-sandbox';
import type {
  CreateRuntimeSandboxRequest,
  RuntimeHealthResult,
  RuntimeSandboxService,
} from '../src/sandbox/domain/ports/runtime-sandbox-service';
import { CriticSteps } from '../src/critic/application/services/critic-steps';
import { SandboxPatchApplier } from '../src/critic/application/services/patch-applier';
import { CriticBuildCheck } from '../src/critic/application/services/build-check';
import { CriticRegressionTestRunner } from '../src/critic/application/services/test-runner';
import { CriticSecurityReviewGate } from '../src/critic/application/services/security-review-gate';
import { CriticAdvisoryReviewer } from '../src/critic/application/services/llm-review';
import { CriticOutcomeWriter } from '../src/critic/application/services/critic-outcome';
import { DefaultCriticService } from '../src/critic/application/services/critic.service';
import { DefaultAgentExecutionService } from '../src/agent/application/services/agent-execution.service';
import { MemoryAgentExecutionRepository } from './helpers/memory-agent-execution-repository';
import {
  MemoryCriticEventSink,
  MemoryCriticRepository,
  MemoryPatchReviewRepository,
  StubCriticFindingResolver,
  StubEngineerSourceReader,
  StubSniperService,
  criticPatch,
  criticContext,
  confirmedSqliFinding,
} from './helpers/critic-fakes';
import { pollReady, runDocker } from './helpers/runtime-e2e-fixture';

const ENABLED = process.env.CRITIC_E2E === '1';
const FIXTURE_TAG = 'amass-critic-fixture:latest';

/**
 * The vulnerable app served on /search, plus the exact parameterizing patch
 * build (the same unified-diff the real pipeline treats as the patch).
 */
const APP_SOURCE = `import http.server, sqlite3

DB = '/tmp/app.db'

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/search'):
            q = self.path.split('q=', 1)[1] if 'q=' in self.path else ''
            con = sqlite3.connect(DB)
            cur = con.execute("SELECT * FROM users WHERE id = '" + q + "'")
            body = ('rows=' + str(cur.fetchall())).encode()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()
    def log_message(self, *args):
        pass

if __name__ == '__main__':
    http.server.HTTPServer(('0.0.0.0', 3000), Handler).serve_forever()
`;

function parameterizedDiff(): string {
  const lines = APP_SOURCE.split('\n');
  const idx = lines.findIndex((l) => l.includes('cur = con.execute'));
  const ctx = [lines[idx - 1], lines[idx], lines[idx + 1]];
  return [
    '--- a/app.py',
    '+++ b/app.py',
    `@@ -${idx},3 +${idx},3 @@`,
    ` ${ctx[0]}`,
    `-${ctx[1]}`,
    `+    cur = con.execute("SELECT * FROM users WHERE id = %s", (q,))`,
    ` ${ctx[2]}`,
    '',
  ].join('\n');
}

async function buildFixtureImage(): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-critic-img-'));
  await fs.writeFile(path.join(dir, 'app.py'), APP_SOURCE);
  await fs.writeFile(
    path.join(dir, 'Dockerfile'),
    'FROM python:3.11-slim\nCOPY app.py /app/app.py\nWORKDIR /app\nCMD ["python", "app.py"]\n',
  );
  runDocker(['build', '-q', '--label', 'amass.manager=1', '-t', FIXTURE_TAG, dir], 900_000);
}

/** Real RuntimeSandboxService over the real Docker backend. */
class RealRuntimeSeam implements RuntimeSandboxService {
  readonly destroyed: string[] = [];
  private readonly prober = new TcpHttpHealthProber();

  constructor(private readonly manager: SandboxManager) {}

  async create(input: CreateRuntimeSandboxRequest): Promise<RuntimeSandbox> {
    const raw: Sandbox = await this.manager.createSandbox({
      scanId: input.scanId,
      type: 'app',
      repositoryPath: input.repository.path ?? '',
      image: FIXTURE_TAG,
      mountRepository: false, // the image carries the payload
      appCommand: [], // image CMD: python app.py
      hostPublishLocalhost: { containerPort: 3000 },
    });
    const sandbox: Sandbox = await this.manager.waitUntilReady(raw.id, 120_000);
    const runtime: RuntimeSandbox = {
      id: `rt-${input.scanId}`,
      scanId: input.scanId,
      status: 'READY',
      sandboxId: sandbox.id,
      imageId: null,
      imageName: sandbox.image ?? FIXTURE_TAG,
      networkId: sandbox.networkId ?? null,
      targetUrl: `http://127.0.0.1:${sandbox.exposedPort}`,
      internalHost: 'app',
      internalPort: 3000,
      exposedPort: sandbox.exposedPort ?? null,
      workspacePath: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      destroyedAt: null,
      failureStage: null,
      failureReason: null,
    };
    this.current.set(runtime.id, runtime);
    return runtime;
  }

  private readonly current = new Map<string, RuntimeSandbox>();

  async get(id: string): Promise<RuntimeSandbox> {
    const found = this.current.get(id);
    if (!found) throw new Error(`runtime ${id} not found`);
    return found;
  }

  async healthCheck(id: string): Promise<RuntimeHealthResult> {
    const runtime = await this.get(id);
    const health = await this.prober.probe(runtime as never);
    return {
      ok: health?.ok === true,
      status: health?.ok === true ? 'READY' : 'FAILED',
      statusCode: health?.statusCode,
      detail: health?.detail,
      checkedAt: new Date().toISOString(),
    };
  }

  async destroy(id: string): Promise<RuntimeSandbox> {
    const runtime = await this.get(id);
    this.destroyed.push(runtime.sandboxId ?? id);
    if (runtime.sandboxId) {
      await this.manager.destroy(runtime.sandboxId).catch(() => undefined);
    }
    return { ...runtime, status: 'DESTROYED', destroyedAt: new Date().toISOString() };
  }

  async expire(id: string): Promise<RuntimeSandbox> {
    return this.destroy(id);
  }

  async cleanupExpired(): Promise<number> {
    return 0;
  }
}

describe.skipIf(!ENABLED)('Critic live Docker pipeline (CRITIC_E2E=1)', () => {
  it('approves a real patch in a real fresh container with zero residue', async () => {
    let sandboxId: string | null = null;
    try {
      await buildFixtureImage();
      const manager = new SandboxManagerService({
        backend: new DockerSandboxBackend(),
        store: new MemorySandboxStore(),
      });
      const runtime = new RealRuntimeSeam(manager);
      const events = new MemoryCriticEventSink();

      // 1. Fresh disposable container (the original repo is never touched).
      const fresh = await runtime.create({
        scanId: 'scan-critic-live',
        repository: { name: 'fixture', url: undefined, path: undefined },
        hostExpose: true,
      });
      sandboxId = fresh.sandboxId;
      const targetUrl = fresh.targetUrl!;
      await pollReady(async () => {
        const res = await fetch(`${targetUrl}/search?q=1`).catch(() => null);
        return res !== null && res.status === 200;
      }, 30_000, 'app http answers');

      // 2. Baseline + retest (real container; sniper runs stay stubbed).
      const sniper = new StubSniperService();
      sniper.program('CONFIRMED', 'NOT_CONFIRMED');

      const steps = new CriticSteps({
        runtimeService: runtime,
        sniper,
        applier: new SandboxPatchApplier(
          manager,
          new StubEngineerSourceReader({ 'app.py': APP_SOURCE }),
          { maxPatchBytes: 16_000, maxSourceBytes: 160_000 },
        ),
        buildCheck: new CriticBuildCheck(manager, { timeoutMs: 30_000, maxOutputChars: 800 }),
        testRunner: new CriticRegressionTestRunner(manager, { timeoutMs: 30_000, maxOutputChars: 800 }),
        securityGate: new CriticSecurityReviewGate(),
        llmReview: new CriticAdvisoryReviewer(null, { get: async () => '' }),
        events,
        config: { checkTimeoutMs: 30_000, testTimeoutMs: 30_000, retestTimeoutMs: 30_000, advisoryEnabled: false },
      });

      const patches = new MemoryPatchReviewRepository();
      const findings = new StubCriticFindingResolver();
      const results = new MemoryCriticRepository();
      const executions = new DefaultAgentExecutionService(new MemoryAgentExecutionRepository());
      const patch = criticPatch({ filePath: 'app.py', diffContent: parameterizedDiff() });
      patches.seed(patch);
      findings.seed(patch.id, criticContext({ finding: confirmedSqliFinding() }));

      const critic = new DefaultCriticService({
        patches,
        findings,
        steps,
        events,
        outcomes: new CriticOutcomeWriter(results, executions),
        results,
      });

      const outcome = await critic.run({ patchId: patch.id });

      expect(outcome.status).toBe('APPROVED');
      expect(patches.statusOf(patch.id)).toBe('APPROVED');
      expect(outcome.exploit?.retest.status).toBe('NOT_CONFIRMED');
      expect(runtime.destroyed).toContain(fresh.sandboxId);
    } finally {
      if (sandboxId) {
        try {
          runDocker(['rm', '-f', sandboxId], 60_000);
        } catch {
          /* already destroyed by the pipeline */
        }
      }
      const survivors = runDocker(['ps', '-aq', '--filter', 'label=amass.manager=1'])
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      expect(survivors).toEqual([]);
    }
  });
});