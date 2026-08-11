#!/usr/bin/env npx tsx
/**
 * AMASS research metrics collector.
 *
 * Turns DURABLE scan artifacts (Scan / AgentExecution / Exploit /
 * VerificationAttempt / Patch / CriticRun / RuntimeSandbox / ScoutScan /
 * AttackPlan rows) into a structured, paper-ready metrics report, optionally
 * scored against the benchmark corpus in `benchmarks/corpus.json`.
 *
 * Design notes
 *  - Reads Postgres only (no live EventBus dependency): every metric below is
 *    reproducible after the fact. Event-level stage timing that is not yet
 *    persisted is explicitly left out (see "remaining gaps" in the README).
 *  - Ground truth joins on the repository URL (ScanRepository -> Repository),
 *    falling back to the scan name.
 *  - Nothing here mutates application state; the optional --check-docker flag
 *    only runs read-only `docker` filters to verify zero sandbox leftovers.
 *
 * Usage (from backend/):
 *   npx tsx scripts/collect-metrics.ts --scan <scanId>
 *   npx tsx scripts/collect-metrics.ts --name <substring>        # name LIKE
 *   npx tsx scripts/collect-metrics.ts --recent 10               # default
 *   npx tsx scripts/collect-metrics.ts --scan <id> --out report.json --check-docker
 *
 * Env: DATABASE_URL (dotenv loads backend/../.env automatically).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { PrismaClient } from '@prisma/client';
import { parseCorpus, findApp, type BenchmarkCorpus, type CorpusApp } from '../src/benchmarks/corpus';
import {
  buildDetectionReport,
  buildReconReport,
  type ExploitView,
  type VulnerabilityView,
  type DetectionReport,
} from '../src/benchmarks/ground-truth';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  scanId: string | null;
  name: string | null;
  recent: number;
  corpusPath: string | null;
  outPath: string | null;
  checkDocker: boolean;
  maxScans: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    scanId: null,
    name: null,
    recent: 10,
    corpusPath: null,
    outPath: null,
    checkDocker: false,
    maxScans: 200,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      i += 1;
      return v;
    };
    switch (a) {
      case '--scan':
        args.scanId = next();
        break;
      case '--name':
        args.name = next();
        break;
      case '--recent':
        args.recent = Number.parseInt(next(), 10);
        if (!Number.isFinite(args.recent) || args.recent < 1) throw new Error('--recent expects a positive integer');
        break;
      case '--corpus':
        args.corpusPath = next();
        break;
      case '--out':
        args.outPath = next();
        break;
      case '--max-scans':
        args.maxScans = Number.parseInt(next(), 10);
        break;
      case '--check-docker':
        args.checkDocker = true;
        break;
      case '--help':
      case '-h':
        console.log(`usage: npx tsx scripts/collect-metrics.ts [--scan <id> | --name <sub> | --recent N] [--out file] [--corpus path] [--check-docker] [--max-scans N]`);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown flag ${a}`);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function pct(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]!);
}

function durationStats(values: readonly (number | null | undefined)[]): {
  n: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  totalMs: number;
} {
  const ms = values.filter((v): v is number => typeof v === 'number' && v >= 0);
  if (ms.length === 0) return { n: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0, totalMs: 0 };
  const sorted = [...ms].sort((a, b) => a - b);
  return {
    n: ms.length,
    meanMs: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length),
    p50Ms: pct(sorted, 50),
    p95Ms: pct(sorted, 95),
    maxMs: sorted[sorted.length - 1]!,
    totalMs: ms.reduce((a, b) => a + b, 0),
  };
}

// ---------------------------------------------------------------------------
// Docker leftover check (read-only)
// ---------------------------------------------------------------------------

function dockerLeftovers(): { containers: number; networks: number; images: number } {
  const count = (args: string[]): number => {
    try {
      const out = execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return out.trim() === '' ? 0 : out.trim().split(/\s+/).length;
    } catch {
      return -1; // docker unavailable
    }
  };
  return {
    containers: count(['ps', '-aq', '--filter', 'label=amass.manager=1']),
    networks: count(['network', 'ls', '-q', '--filter', 'label=amass.manager=1']),
    images: count(['images', '-q', '--filter', 'label=amass.manager=1']),
  };
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

type ScanWithRelations = NonNullable<Awaited<ReturnType<typeof loadScan>>>;

interface StageSummary {
  agentType: string;
  runs: number;
  completed: number;
  failed: number;
  timedOut: number;
  duration: ReturnType<typeof durationStats>;
}

interface ScanReport {
  scanId: string;
  name: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  spanMs: number | null;
  repoUrl: string | null;
  corpusApp: string | null;
  stages: StageSummary[];
  sandbox: {
    provisioned: number;
    ready: number;
    failed: number;
    destroyed: number;
    expired: number;
    failureReasons: Record<string, number>;
  };
  scout: {
    scans: number;
    surfaces: number;
    statuses: Record<string, number>;
    recon: { expected: number; discovered: number; recall: number; missing: string[] } | null;
  };
  planner: { plans: number; targets: number; coveredSurfaces: number; coveredFindings: number };
  detection: DetectionReport | null;
  remediation: {
    patches: { total: number; generated: number; approved: number; validated: number; rejected: number; failed: number };
    criticRuns: { total: number; approved: number; rejected: number; failed: number };
    firstAttemptApprovalRate: number | null;
    retriesNeeded: Record<string, number>;
  };
  costProxy: { agentRuns: number; totalExecutionMs: number; llmStageRuns: number };
  isolation: { containers: number; networks: number; images: number };
}

async function loadScan(prisma: PrismaClient, scanId: string) {
  return prisma.scan.findUnique({
    where: { id: scanId },
    include: {
      repositories: { include: { repository: true } },
      agentExecutions: true,
      vulnerabilities: { include: { patches: { include: { criticRuns: true } } } },
      exploits: { include: { vulnerability: { select: { cweId: true, status: true } } } },
      runtimeSandboxes: true,
      scoutScans: { include: { surfaces: true } },
      attackPlans: { include: { targets: true } },
    },
  });
}

function exploitViews(scan: ScanWithRelations): ExploitView[] {
  return scan.exploits.map((e) => ({
    id: e.id,
    endpoint: e.endpoint,
    method: e.method,
    parameter: e.parameter ?? null,
    vulnerabilityType: e.vulnerabilityType ?? null,
    cweId: e.vulnerability?.cweId ?? null,
    status: e.status,
  }));
}

function vulnerabilityViews(scan: ScanWithRelations): VulnerabilityView[] {
  return scan.vulnerabilities.map((v) => ({
    id: v.id,
    cweId: v.cweId ?? null,
    vulnType: v.vulnType ?? null,
    status: v.status,
    filePath: v.filePath ?? null,
  }));
}

function assembleReport(
  scan: ScanWithRelations,
  corpus: BenchmarkCorpus,
  args: CliArgs
): ScanReport {
  const repoUrl = scan.repositories[0]?.repository.url ?? null;
  const app: CorpusApp | null = findApp(corpus, repoUrl, scan.name);

  // --- Stages (durable AgentExecution rows) --------------------------------
  const byAgent = new Map<string, typeof scan.agentExecutions>();
  for (const exec of scan.agentExecutions) {
    const list = byAgent.get(exec.agentType) ?? [];
    list.push(exec);
    byAgent.set(exec.agentType, list);
  }
  const stages: StageSummary[] = [...byAgent.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([agentType, runs]) => ({
      agentType,
      runs: runs.length,
      completed: runs.filter((r) => r.status === 'COMPLETED').length,
      failed: runs.filter((r) => r.status === 'FAILED').length,
      timedOut: runs.filter((r) => r.status === 'TIMEOUT').length,
      duration: durationStats(runs.map((r) => r.durationMs)),
    }));

  // --- Sandbox lifecycle ---------------------------------------------------
  const sandbox = {
    provisioned: scan.runtimeSandboxes.length,
    ready: scan.runtimeSandboxes.filter((s) => s.status === 'READY' || s.status === 'DESTROYED' || s.status === 'EXPIRED').length,
    failed: scan.runtimeSandboxes.filter((s) => s.status === 'FAILED').length,
    destroyed: scan.runtimeSandboxes.filter((s) => s.status === 'DESTROYED').length,
    expired: scan.runtimeSandboxes.filter((s) => s.status === 'EXPIRED').length,
    failureReasons: scan.runtimeSandboxes.reduce<Record<string, number>>((acc, s) => {
      if (s.status === 'FAILED' && s.failureReason) acc[s.failureReason] = (acc[s.failureReason] ?? 0) + 1;
      return acc;
    }, {}),
  };

  // --- Recon (Scout) -------------------------------------------------------
  const surfaces = scan.scoutScans.flatMap((s) => s.surfaces.map((f) => ({ url: f.url, method: f.method })));
  const scout = {
    scans: scan.scoutScans.length,
    surfaces: surfaces.length,
    statuses: scan.scoutScans.reduce<Record<string, number>>((acc, s) => {
      acc[s.status] = (acc[s.status] ?? 0) + 1;
      return acc;
    }, {}),
    recon: app ? buildReconReport(app, surfaces) : null,
  };

  // --- Planner -------------------------------------------------------------
  const planner = {
    plans: scan.attackPlans.length,
    targets: scan.attackPlans.reduce((n, p) => n + p.targets.length, 0),
    coveredSurfaces: scan.attackPlans.reduce((n, p) => n + p.coveredSurfaces, 0),
    coveredFindings: scan.attackPlans.reduce((n, p) => n + p.coveredFindings, 0),
  };

  // --- Detection vs ground truth -------------------------------------------
  const detection = app
    ? buildDetectionReport(app, exploitViews(scan), vulnerabilityViews(scan))
    : null;

  // --- Remediation (Engineer + Critic) -------------------------------------
  const patches = scan.vulnerabilities.flatMap((v) => v.patches);
  const criticRuns = patches.flatMap((p) => p.criticRuns);
  const retriesNeeded: Record<string, number> = {};
  for (const patch of patches) {
    const attempts = Math.max(0, ...patch.criticRuns.map((c) => c.attempt));
    const key = String(attempts);
    retriesNeeded[key] = (retriesNeeded[key] ?? 0) + 1;
  }
  const patchesWithCritic = patches.filter((p) => p.criticRuns.length > 0);
  const firstAttemptApproved = patchesWithCritic.filter((p) =>
    p.criticRuns.some((c) => c.attempt === 1 && c.status === 'APPROVED')
  ).length;
  const remediation = {
    patches: {
      total: patches.length,
      generated: patches.filter((p) => p.status === 'GENERATED').length,
      approved: patches.filter((p) => p.status === 'APPROVED').length,
      validated: patches.filter((p) => p.status === 'VALIDATED').length,
      rejected: patches.filter((p) => p.status === 'REJECTED').length,
      failed: patches.filter((p) => p.status === 'FAILED').length,
    },
    criticRuns: {
      total: criticRuns.length,
      approved: criticRuns.filter((c) => c.status === 'APPROVED').length,
      rejected: criticRuns.filter((c) => c.status === 'REJECTED').length,
      failed: criticRuns.filter((c) => c.status === 'FAILED').length,
    },
    firstAttemptApprovalRate: patchesWithCritic.length === 0 ? null : Math.round((firstAttemptApproved / patchesWithCritic.length) * 1000) / 1000,
    retriesNeeded,
  };

  // --- Cost proxy ----------------------------------------------------------
  const totalExecutionMs = scan.agentExecutions.reduce((n, r) => n + (r.durationMs ?? 0), 0);
  const costProxy = {
    agentRuns: scan.agentExecutions.length,
    totalExecutionMs,
    llmStageRuns: stages.filter((s) => s.agentType !== 'SNIPER').reduce((n, s) => n + s.runs, 0),
  };

  return {
    scanId: scan.id,
    name: scan.name,
    status: scan.status,
    createdAt: scan.createdAt.toISOString(),
    completedAt: scan.completedAt?.toISOString() ?? null,
    spanMs:
      scan.startedAt && scan.completedAt ? scan.completedAt.getTime() - scan.startedAt.getTime() : null,
    repoUrl,
    corpusApp: app?.id ?? null,
    stages,
    sandbox,
    scout,
    planner,
    detection,
    remediation,
    costProxy,
    isolation: args.checkDocker ? dockerLeftovers() : { containers: -1, networks: -1, images: -1 },
  };
}

// ---------------------------------------------------------------------------
// Console rendering
// ---------------------------------------------------------------------------

function renderSummary(report: ScanReport): void {
  const line = (k: string, v: string) => console.log(`  ${k.padEnd(24)} ${v}`);
  console.log(`\n=== scan ${report.scanId} (${report.name}) ===`);
  line('status', report.status);
  line('span', report.spanMs === null ? 'n/a' : `${(report.spanMs / 1000).toFixed(1)}s`);
  line('repo', report.repoUrl ?? '-');
  line('corpus app', report.corpusApp ?? 'not in corpus');

  if (report.detection) {
    const s = report.detection.aggregates.sniper;
    console.log('  detection (sniper scope)');
    line('TP / FN / FP', `${s.truePositive} / ${s.falseNegative} / ${s.falsePositive}`);
    line('recall / precision', `${s.recall} / ${s.precision}`);
    line('F1', String(s.f1));
    console.log('  detection (static scope)');
    line('TP / FN', `${report.detection.aggregates.static.truePositive} / ${report.detection.aggregates.static.falseNegative}`);
    line('future (not scored)', String(report.detection.aggregates.futureCount));
  }

  if (report.scout.recon) {
    const r = report.scout.recon;
    line('recon recall', `${r.recall} (${r.expected - r.missing.length}/${r.expected} expected matched; ${r.discovered} total discovered)`);
  }

  console.log('  stages');
  for (const s of report.stages) {
    console.log(
      `    ${s.agentType.padEnd(10)} runs=${s.runs} ok=${s.completed} fail=${s.failed} timeout=${s.timedOut} ` +
        `mean=${(s.duration.meanMs / 1000).toFixed(1)}s p95=${(s.duration.p95Ms / 1000).toFixed(1)}s`
    );
  }

  console.log('  remediation');
  line('patches', `${report.remediation.patches.total} (approved ${report.remediation.patches.approved}, rejected ${report.remediation.patches.rejected})`);
  line('critic first-attempt rate', report.remediation.firstAttemptApprovalRate === null ? 'n/a' : String(report.remediation.firstAttemptApprovalRate));

  console.log('  sandbox');
  line('provisioned/ready/failed', `${report.sandbox.provisioned}/${report.sandbox.ready}/${report.sandbox.failed}`);
  if (report.sandbox.failureReasons && Object.keys(report.sandbox.failureReasons).length > 0) {
    line('failures', JSON.stringify(report.sandbox.failureReasons));
  }

  if (report.isolation.containers >= 0) {
    line('docker leftovers', `containers=${report.isolation.containers} networks=${report.isolation.networks} images=${report.isolation.images}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const corpusPath = args.corpusPath ?? path.resolve(__dirname, '../../benchmarks/corpus.json');
  const corpus = parseCorpus(JSON.parse(fs.readFileSync(corpusPath, 'utf8')));

  const prisma = new PrismaClient();
  try {
    const scans: ScanWithRelations[] = [];
    if (args.scanId) {
      const scan = await loadScan(prisma, args.scanId);
      if (!scan) throw new Error(`scan ${args.scanId} not found`);
      scans.push(scan);
    } else {
      const where = args.name ? { name: { contains: args.name } } : {};
      const rows = await prisma.scan.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(args.recent, args.maxScans),
        select: { id: true },
      });
      for (const row of rows) {
        const scan = await loadScan(prisma, row.id);
        if (scan) scans.push(scan);
      }
    }

    if (scans.length === 0) {
      console.log('no scans matched — nothing to report');
      return;
    }

    const reports = scans.map((scan) => assembleReport(scan, corpus, args));
    for (const report of reports) renderSummary(report);

    const out = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        corpus: corpusPath,
        reports,
      },
      null,
      2
    );
    if (args.outPath) {
      fs.writeFileSync(args.outPath, out);
      console.log(`\nreport written to ${args.outPath}`);
    } else {
      console.log(`\n${out}`);
    }
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(`collect-metrics: ${(err as Error).message}`);
  process.exitCode = 1;
});
