/**
 * Critic test fakes — deterministic substitutes for every Critic port.
 * No Docker, no database, no network. Programmable outcomes drive the
 * full-pipeline tests (approve/reject/infra-fail/baseline-invalid …).
 */

import type { RuntimeSandboxContext } from '../../src/sandbox/domain/entities/runtime-sandbox';
import type { RuntimeSandbox, RuntimeRepositoryRef } from '../../src/sandbox/domain/entities/runtime-sandbox';
import type { RuntimeSandboxService, RuntimeHealthResult } from '../../src/sandbox/domain/ports/runtime-sandbox-service';
import type { SniperService, RunSniperInput, SniperRunReport } from '../../src/sniper/domain/ports/sniper-service';
import type { ProofOfConcept } from '../../src/sniper/domain/models/verification';
import type { CriticRepository, SaveCriticRunInput } from '../../src/critic/domain/ports/critic-repository';
import type { CriticRunResult } from '../../src/critic/domain/models/critic-result';
import type {
  PatchReviewRepository,
  ReviewablePatch,
  ReviewablePatchStatus,
} from '../../src/critic/domain/ports/patch-review-repository';
import type { CriticFindingResolver, CriticPatchContext } from '../../src/critic/domain/ports/critic-finding-resolver';
import type { CriticEvent, CriticEventSink } from '../../src/critic/domain/events/critic-events';
import { CRITIC_EVENT_MAX_PER_RUN } from '../../src/critic/domain/events/critic-events';
import type { ConfirmedVulnerabilityFinding } from '../../src/engineer/domain/ports/confirmed-finding-repository';
import { ProgrammedSandboxManager } from './programmed-sandbox-manager';
import type { ExecResult, Sandbox, SandboxPatch } from '../../src/sandbox/domain/models/sandbox';

// ---------------------------------------------------------------------------
// Persistence fakes
// ---------------------------------------------------------------------------

export class MemoryCriticRepository implements CriticRepository {
  readonly rows = new Map<string, CriticRunResult>();

  async save(input: SaveCriticRunInput): Promise<CriticRunResult> {
    const id = `${input.patchId}#${input.attempt}`;
    const existing = this.rows.get(id);
    if (existing) return existing;
    const row: CriticRunResult = {
      id,
      patchId: input.patchId,
      vulnerabilityId: input.vulnerabilityId,
      scanId: input.scanId,
      executionId: input.executionId,
      attempt: input.attempt,
      status: input.status,
      failureKind: input.failureKind,
      checks: input.checks as CriticRunResult['checks'],
      exploit: input.exploit as CriticRunResult['exploit'],
      feedback: input.feedback as CriticRunResult['feedback'],
      errorMessage: (input as { errorMessage?: string | null }).errorMessage ?? null,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
    };
    this.rows.set(id, row);
    return row;
  }

  async getById(id: string): Promise<CriticRunResult | null> {
    return this.rows.get(id) ?? null;
  }

  async listByPatch(patchId: string): Promise<readonly CriticRunResult[]> {
    return [...this.rows.values()]
      .filter((r) => r.patchId === patchId)
      .sort((a, b) => a.attempt - b.attempt);
  }

  async getByExecutionId(executionId: string): Promise<CriticRunResult | null> {
    for (const row of this.rows.values()) {
      if (row.executionId === executionId) return row;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Patch + finding fakes
// ---------------------------------------------------------------------------

export class MemoryPatchReviewRepository implements PatchReviewRepository {
  readonly patches = new Map<string, { patch: ReviewablePatch; status: ReviewablePatchStatus }>();

  seed(patch: ReviewablePatch): void {
    this.patches.set(patch.id, { patch, status: patch.status });
  }

  async getPatch(patchId: string): Promise<ReviewablePatch | null> {
    const entry = this.patches.get(patchId);
    return entry ? { ...entry.patch, status: entry.status } : null;
  }

  async markUnderReview(patchId: string): Promise<void> {
    const entry = this.patches.get(patchId);
    if (entry && (entry.status === 'GENERATED' || entry.status === 'UNDER_REVIEW')) {
      entry.status = 'UNDER_REVIEW';
    }
  }

  async setVerdict(patchId: string, verdict: 'APPROVED' | 'REJECTED'): Promise<void> {
    const entry = this.patches.get(patchId);
    if (entry && (entry.status === 'GENERATED' || entry.status === 'UNDER_REVIEW')) {
      entry.status = verdict;
    }
  }

  statusOf(patchId: string): ReviewablePatchStatus | null {
    return this.patches.get(patchId)?.status ?? null;
  }
}

export class StubCriticFindingResolver implements CriticFindingResolver {
  private readonly contexts = new Map<string, CriticPatchContext>();

  seed(patchId: string, ctx: CriticPatchContext): void {
    this.contexts.set(patchId, ctx);
  }

  async resolveForPatch(patchId: string): Promise<CriticPatchContext | null> {
    return this.contexts.get(patchId) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Runtime + sniper fakes
// ---------------------------------------------------------------------------

export class StubRuntimeSandboxService implements RuntimeSandboxService {
  readonly created: Array<{ scanId: string; repository: RuntimeRepositoryRef }> = [];
  readonly destroyed: string[] = [];
  healthy = true;
  createError: Error | null = null;
  /** When set, health checks from this call index onward return unhealthy. */
  failHealthFrom: number | null = null;
  private nextId = 0;
  private healthCalls = 0;

  async create(input: { scanId: string; repository: RuntimeRepositoryRef; hostExpose?: boolean; name?: string }): Promise<RuntimeSandbox> {
    if (this.createError) {
      const e = this.createError;
      this.createError = null;
      throw e;
    }
    this.created.push({ scanId: input.scanId, repository: input.repository });
    const now = new Date().toISOString();
    return {
      id: `run-${++this.nextId}`,
      scanId: input.scanId,
      sandboxId: `sbx-${this.nextId}`,
      status: 'READY' as const,
      repository: input.repository,
      targetUrl: `http://127.0.0.1:${8000 + this.nextId}`,
      internalHost: '127.0.0.1',
      internalPort: 8000 + this.nextId,
      exposedPort: null,
      targetHost: '127.0.0.1',
      targetPort: 8000 + this.nextId,
      createdAt: now,
      startedAt: now,
      completedAt: null,
      destroyedAt: null,
      owner: 'critic',
      workspacePath: '/tmp/critic-workspace',
    } as unknown as RuntimeSandbox;
  }

  async get(id: string): Promise<RuntimeSandbox> {
    return {
      id,
      scanId: 'scan-1',
      sandboxId: `sbx-${id}`,
      status: 'READY' as const,
      repository: { name: 'fixture' },
      targetUrl: 'http://127.0.0.1:8000',
      internalHost: '127.0.0.1',
      internalPort: 8000,
      exposedPort: null,
      targetHost: '127.0.0.1',
      targetPort: 8000,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      destroyedAt: null,
      owner: 'critic',
      workspacePath: '/tmp/critic-workspace',
    } as unknown as RuntimeSandbox;
  }

  async healthCheck(id: string): Promise<RuntimeHealthResult> {
    this.healthCalls += 1;
    if (!this.healthy || (this.failHealthFrom !== null && this.healthCalls >= this.failHealthFrom)) {
      return { ok: false, status: 'STARTING' as const, checkedAt: new Date().toISOString() };
    }
    return { ok: true, status: 'READY' as const, checkedAt: new Date().toISOString() };
  }

  async destroy(id: string): Promise<RuntimeSandbox> {
    this.destroyed.push(id);
    return this.get(id);
  }

  async expire(id: string): Promise<RuntimeSandbox> {
    return this.get(id);
  }

  async cleanupExpired(): Promise<number> {
    return 0;
  }

  readonly limits = {} as RuntimeSandboxService['limits'];
}

export class StubSniperService implements SniperService {
  /** Programmed exploit statuses per run call, in order (last repeats). */
  private outcomes: string[] = ['CONFIRMED'];
  private calls = 0;
  readonly received: RunSniperInput[] = [];
  failNextError: Error | null = null;

  program(...outcomes: string[]): void {
    this.outcomes = outcomes.length > 0 ? outcomes : ['CONFIRMED'];
    this.calls = 0;
    this.failNextError = null;
  }

  failNext(error: Error): void {
    this.failNextError = error;
  }

  async run(input: RunSniperInput): Promise<SniperRunReport> {
    this.received.push(input);
    if (this.failNextError) {
      const e = this.failNextError;
      this.failNextError = null;
      throw e;
    }
    const status = this.outcomes[Math.min(this.calls, this.outcomes.length - 1)];
    this.calls += 1;
    const poc: ProofOfConcept = {
      id: `poc-${this.calls}`,
      targetId: input.targetIds[0],
      scanId: input.scanId,
      vulnerabilityType: 'SQL_INJECTION',
      status: status as ProofOfConcept['status'],
      endpoint: '/search',
      method: 'GET',
      parameter: 'q',
      confidence: status === 'CONFIRMED' ? 0.97 : 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return {
      runId: `sniper-run-${this.calls}`,
      scanId: input.scanId,
      sandboxId: input.sandboxId,
      results: [{ targetId: input.targetIds[0], exploit: poc }],
      completed: 1,
      total: 1,
    };
  }

  async getExploit(id: string): Promise<ProofOfConcept | null> {
    return null;
  }
  async getExploitResults(id: string): Promise<null> {
    return null;
  }
  async listExploitsForTarget(targetId: string): Promise<readonly ProofOfConcept[]> {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Event sink fake
// ---------------------------------------------------------------------------

export class MemoryCriticEventSink implements CriticEventSink {
  readonly events: CriticEvent[] = [];
  private readonly byRun = new Map<string, CriticEvent[]>();

  emit(event: CriticEvent): void {
    this.events.push(event);
    const list = this.byRun.get(event.runId) ?? [];
    list.push(event);
    if (list.length > CRITIC_EVENT_MAX_PER_RUN) list.splice(0, list.length - CRITIC_EVENT_MAX_PER_RUN);
    this.byRun.set(event.runId, list);
  }

  forRun(runId: string): CriticEvent[] {
    return this.byRun.get(runId) ?? [];
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function confirmedSqliFinding(overrides: Partial<ConfirmedVulnerabilityFinding> = {}): ConfirmedVulnerabilityFinding {
  return {
    vulnerabilityId: 'vuln-1',
    scanId: 'scan-1',
    exploitId: 'exploit-1',
    type: 'SQL_INJECTION',
    status: 'CONFIRMED',
    severity: 'HIGH',
    confidence: 0.97,
    cwe: 'CWE-89',
    cve: null,
    title: 'SQL injection in /search',
    message: 'string concatenation in SQL query',
    filePath: 'src/app.py',
    lineNumber: 12,
    endpoint: '/search',
    method: 'GET',
    parameter: 'q',
    evidence: 'sqlmap:injection_point',
    reason: 'confirmed via sqlmap',
    exploitDepth: 2,
    confirmedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function criticPatch(overrides: Partial<ReviewablePatch> = {}): ReviewablePatch {
  const patch = {
    id: 'patch-1',
    vulnerabilityId: 'vuln-1',
    status: 'GENERATED',
    filePath: 'src/app.py',
    diffContent: CRITIC_FIXTURE_DIFF,
    explanation: 'parameterized query',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  // status stays GENERATED unless the caller explicitly overrides it
  if (overrides.status === undefined) patch.status = 'GENERATED';
  return patch;
}

export function criticContext(overrides: Partial<CriticPatchContext> = {}): CriticPatchContext {
  const finding = confirmedSqliFinding(overrides.finding);
  return {
    finding,
    exploitTargetId: 'target-1',
    endpoint: '/search',
    method: 'GET',
    ...overrides,
  };
}

export const CRITIC_FIXTURE_DIFF = `--- a/src/app.py
+++ b/src/app.py
@@ -6,3 +6,3 @@
     query = "SELECT * FROM users WHERE id = " + user_input
-    cur.execute(query)
+    cur.execute("SELECT * FROM users WHERE id = %s", (user_input,))
     return cur.fetchall()
`;

export const CRITIC_BASE_SOURCE = `import sqlite3

def search(user_input):
    conn = sqlite3.connect("app.db")
    cur = conn.cursor()
    query = "SELECT * FROM users WHERE id = " + user_input
    cur.execute(query)
    return cur.fetchall()
`;

export const CRITIC_PATCHED_SOURCE = `import sqlite3

def search(user_input):
    conn = sqlite3.connect("app.db")
    cur = conn.cursor()
    query = "SELECT * FROM users WHERE id = " + user_input
    cur.execute("SELECT * FROM users WHERE id = %s", (user_input,))
    return cur.fetchall()
`;
// ---------------------------------------------------------------------------
// Scripted manager — argv-ruleable execute + recording applyPatch, for
// build/test/apply steps inside the pipeline tests.
// ---------------------------------------------------------------------------

export class ScriptedSandboxManager extends ProgrammedSandboxManager {
  readonly rules = new Map<string, ExecResult>();
  readonly applied: Array<{ id: string; patches: readonly SandboxPatch[] }> = [];
  // own copies (vitest/esbuild does not reliably land the base class fields)
  readonly execCalls: Array<{ sandboxId: string; request: { argv: readonly string[]; timeoutMs?: number } }> = [];
  readonly sandboxes = new Map<string, Sandbox>();
  readonly destroyed: string[] = [];
  readonly createCalls: Array<{ scanId: string; network?: string }> = [];

  rule(argv: readonly string[], result: ExecResult): void {
    this.rules.set(argv.join(`\x1f`), result);
  }

  async execute(sandboxId: string, request: { argv: readonly string[]; timeoutMs?: number }): Promise<ExecResult> {
    this.execCalls.push({ sandboxId, request });
    return this.rules.get(request.argv.join(`\x1f`)) ?? { stdout: '', stderr: '', exitCode: 1, timedOut: false };
  }

  async applyPatch(id: string, patches: readonly SandboxPatch[]): Promise<Sandbox> {
    this.applied.push({ id, patches });
    const sandbox = this.sandboxes.get(id);
    if (sandbox) return sandbox;
    return {
      id,
      scanId: 'scan-1',
      type: 'exec',
      status: 'ready' as const,
      image: 'fixture:latest',
      repositoryPath: '/tmp/fixture',
      network: { egress: 'none', allowlist: [] },
      containerId: `ctr_${id}`,
      networkId: 'net',
      ipAddress: '172.19.0.10',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
