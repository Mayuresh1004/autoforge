/**
 * Prisma-backed CriticRun persistence. One row per validation attempt;
 * a deterministic row id (`{patchId}#{attempt}`) guarantees attempts are
 * never overwritten — a second save for the same attempt returns the
 * existing row (idempotent). JSON columns are re-validated at read time.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import type { CriticRepository, SaveCriticRunInput } from '../../domain/ports/critic-repository';
import type { CriticRunResult } from '../../domain/models/critic-result';
import type { CriticCheck } from '../../domain/models/critic-result';
import type { ExploitCriticOutcome } from '../../domain/models/critic-result';
import type { CriticFeedback } from '../../domain/models/critic-result';
import { isCriticStatus, CRITIC_FAILURE_KINDS } from '../../domain/models/critic-result';

export class PrismaCriticRepository implements CriticRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(input: SaveCriticRunInput): Promise<CriticRunResult> {
    const id = `${input.patchId}#${input.attempt}`;
    const existing = await this.prisma.criticRun.findUnique({ where: { id } });
    if (existing) {
      return mapRow(existing as unknown as CriticRow);
    }
    await this.prisma.criticRun.create({
      data: {
        id,
        patchId: input.patchId,
        vulnerabilityId: input.vulnerabilityId,
        scanId: input.scanId,
        executionId: input.executionId,
        attempt: input.attempt,
        status: input.status,
        failureReason: input.failureKind ?? null,
        checks: input.checks as Prisma.InputJsonValue,
        exploitResult: input.exploit === null ? Prisma.JsonNull : (input.exploit as Prisma.InputJsonValue),
        feedback: input.feedback === null ? Prisma.JsonNull : (input.feedback as Prisma.InputJsonValue),
        errorMessage: input.errorMessage ?? null,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
      },
    });
    const created = await this.prisma.criticRun.findUnique({ where: { id } });
    return created ? mapRow(created as unknown as CriticRow) : mapRowFromInput(input);
  }

  async getById(id: string): Promise<CriticRunResult | null> {
    const row = await this.prisma.criticRun.findUnique({ where: { id } });
    return row ? mapRow(row as unknown as CriticRow) : null;
  }

  async listByPatch(patchId: string): Promise<readonly CriticRunResult[]> {
    const rows = await this.prisma.criticRun.findMany({
      where: { patchId },
      orderBy: [{ attempt: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => mapRow(row as unknown as CriticRow));
  }

  async getByExecutionId(executionId: string): Promise<CriticRunResult | null> {
    const row = await this.prisma.criticRun.findFirst({ where: { executionId } });
    return row ? mapRow(row as unknown as CriticRow) : null;
  }
}

interface CriticRow {
  id: string;
  patchId: string;
  vulnerabilityId: string;
  scanId: string | null;
  executionId: string | null;
  attempt: number;
  status: string;
  failureReason: string | null;
  checks: unknown;
  exploitResult: unknown;
  feedback: unknown;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: Date;
}

function mapRow(row: CriticRow): CriticRunResult {
  const status = isCriticStatus(row.status) ? row.status : 'FAILED';
  const failureKind =
    row.failureReason && (CRITIC_FAILURE_KINDS as readonly string[]).includes(row.failureReason)
      ? (row.failureReason as CriticRunResult['failureKind'])
      : null;
  return {
    id: row.id,
    patchId: row.patchId,
    vulnerabilityId: row.vulnerabilityId,
    scanId: row.scanId ?? '',
    executionId: row.executionId ?? null,
    attempt: row.attempt,
    status,
    failureKind,
    checks: asChecks(row.checks),
    exploit: asExploit(row.exploitResult),
    feedback: asFeedback(row.feedback),
    errorMessage: row.errorMessage,
    startedAt: row.startedAt ?? row.createdAt.toISOString(),
    completedAt: row.completedAt,
  };
}

/** Fallback when the just-created row is not re-readable (never loses data). */
function mapRowFromInput(input: SaveCriticRunInput): CriticRunResult {
  return {
    id: `${input.patchId}#${input.attempt}`,
    patchId: input.patchId,
    vulnerabilityId: input.vulnerabilityId,
    scanId: input.scanId,
    executionId: input.executionId,
    attempt: input.attempt,
    status: input.status,
    failureKind: input.failureKind,
    checks: input.checks as CriticCheck[],
    exploit: input.exploit as ExploitCriticOutcome | null,
    feedback: input.feedback as CriticFeedback | null,
    errorMessage: input.errorMessage ?? null,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  };
}

function asChecks(value: unknown): readonly CriticCheck[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
    .map((c) => ({
      name: String(c.name ?? '') as CriticCheck['name'],
      status: String(c.status ?? 'ERROR') as CriticCheck['status'],
      durationMs: typeof c.durationMs === 'number' ? c.durationMs : 0,
      detail: typeof c.detail === 'string' ? c.detail.slice(0, 500) : undefined,
      code: typeof c.code === 'string' ? c.code : null,
    }))
    .filter((c) => c.name.length > 0);
}

function asExploit(value: unknown): ExploitCriticOutcome | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { baseline?: unknown; retest?: unknown; targetId?: unknown };
  const baseline = v.baseline as { status?: unknown; reason?: unknown } | undefined;
  const retest = v.retest as { status?: unknown; reason?: unknown } | undefined;
  return {
    baseline: {
      status: String(baseline?.status ?? 'NOT_TESTED') as ExploitCriticOutcome['baseline']['status'],
      reason: str(baseline?.reason),
    },
    retest: {
      status: String(retest?.status ?? 'NOT_TESTED') as ExploitCriticOutcome['retest']['status'],
      reason: str(retest?.reason),
    },
    targetId: String(v.targetId ?? ''),
  };
}

function asFeedback(value: unknown): CriticFeedback | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { reason?: unknown; failedChecks?: unknown; guidance?: unknown; evidence?: unknown };
  if (typeof v.reason !== 'string') return null;
  const failedChecks = Array.isArray(v.failedChecks)
    ? v.failedChecks.filter((c): c is string => typeof c === 'string').slice(0, 6)
    : [];
  const evidence = Array.isArray(v.evidence)
    ? v.evidence
        .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
        .map((e) => ({
          key: String(e.key ?? '').slice(0, 120),
          detail: String(e.detail ?? '').slice(0, 300),
        }))
    : [];
  return {
    reason: v.reason as CriticFeedback['reason'],
    failedChecks,
    guidance: typeof v.guidance === 'string' ? v.guidance.slice(0, 400) : '',
    evidence,
  };
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 300) : null;
}