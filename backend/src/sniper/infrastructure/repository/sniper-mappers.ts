/**
 * Pure row→domain mappers for Sniper persistence. No I/O, no Prisma — this
 * module exists so the repository stays thin and the mapping rules are
 * unit-testable in isolation.
 */
import type {
  AttemptRecord,
  ConfidenceBreakdown,
  EvidenceItem,
  ProofOfConcept,
} from '../../domain/models/verification';
import type { VulnerabilityType } from '../../domain/models/vulnerability-type';

export type EvidenceRow = {
  indicator: string;
  category?: string;
  httpStatus?: number | null;
  detail?: string | null;
  confidenceFactor?: number;
};

export type ExploitRow = {
  id: string;
  targetId: string | null;
  scanId: string;
  vulnerabilityId: string | null;
  vulnerabilityType: string | null;
  status: string;
  confidence: number | null;
  confidenceBreakdown: unknown;
  endpoint: string;
  method: string;
  parameter: string | null;
  tool: string | null;
  statusReason: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  durationMs: number | null;
  evidence?: readonly EvidenceRow[];
  attacks?: number;
  _count?: { attempts: number };
};

export type AttemptRow = {
  id: string;
  exploitId: string;
  attemptNumber: number;
  verifier: string;
  tool: string | null;
  status: string;
  stdout: string | null;
  stderr: string | null;
  errorMessage: string | null;
  exitCode: number | null;
  timedOut: boolean;
  retried: boolean;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
};

/** Map a persisted exploit row (with evidence + attempt count) to a PoC. */
export function mapExploitRow(row: ExploitRow): ProofOfConcept {
  const breakout = (row.confidenceBreakdown ?? null) as ConfidenceBreakdown | null;
  const evidence: EvidenceItem[] = ((row.evidence ?? []) as readonly EvidenceRow[]).map(
    (e) => ({
      indicator: e.indicator,
      category: e.category as EvidenceItem['category'],
      httpStatus: e.httpStatus ?? undefined,
      detail: e.detail ?? undefined,
      confidenceFactor: e.confidenceFactor ?? 0,
    })
  );
  return {
    id: row.id,
    targetId: row.targetId ?? '',
    scanId: row.scanId,
    vulnerabilityId: row.vulnerabilityId ?? null,
    type: (row.vulnerabilityType ?? 'SQL_INJECTION') as VulnerabilityType,
    status: row.status as ProofOfConcept['status'],
    confidence: row.confidence,
    confidenceBreakdown: breakout,
    endpoint: row.endpoint,
    method: row.method,
    parameter: row.parameter,
    verifier: row.tool ?? '',
    tool: row.tool,
    reason: row.statusReason ?? '',
    evidence,
    attacks: row._count !== undefined ? row._count.attempts : Number(row.attacks ?? 0),
    startedAt: (row.startedAt ?? row.createdAt).toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
  };
}

/** Map a persisted attempt row to its domain record. */
export function mapAttemptRow(row: AttemptRow): AttemptRecord {
  return {
    id: row.id,
    exploitId: row.exploitId,
    attemptNumber: row.attemptNumber,
    verifier: row.verifier,
    tool: row.tool ?? null,
    status: row.status as AttemptRecord['status'],
    stdout: row.stdout,
    stderr: row.stderr,
    errorMessage: row.errorMessage,
    exitCode: row.exitCode,
    timedOut: row.timedOut,
    retried: row.retried,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
  };
}

/** Evidence payload → Prisma `evidence: { create: [...] }` shape. */
export function toEvidenceCreate(evidence: readonly EvidenceItem[]) {
  return evidence.map((e) => ({
    indicator: e.indicator,
    category: e.category,
    httpStatus: e.httpStatus ?? null,
    detail: e.detail ?? null,
    confidenceFactor: e.confidenceFactor,
  }));
}