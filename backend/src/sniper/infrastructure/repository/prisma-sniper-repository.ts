import { prisma } from '../../../config/database';
import type {
  AttemptRecord,
  CorrelatedFinding,
  EvidenceItem,
  ProofOfConcept,
} from '../../domain/models/verification';
import type { VulnerabilityType } from '../../domain/models/vulnerability-type';
import type {
  PlannedTargetSnapshot,
  SniperRepository,
  SaveAttemptPayload,
  SaveExploitPayload,
} from '../../domain/ports/sniper-repository';
import {
  toEvidenceCreate,
  mapExploitRow,
  mapAttemptRow,
  type ExploitRow,
} from './sniper-mappers';

/**
 * Prisma adapter for Sniper persistence: loads planned targets + static
 * findings, and records the final exploit row, per-attempt records, and
 * evidence items. Output is redacted/truncated BEFORE it reaches this layer.
 * Row→domain mapping lives in `sniper-mappers.ts`.
 */
export class PrismaSniperRepository implements SniperRepository {
  async loadPlannedTarget(targetId: string): Promise<PlannedTargetSnapshot | null> {
    const row = await prisma.plannedTarget.findFirst({
      where: { targetId },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    return {
      id: row.id,
      targetId: row.targetId,
      scanId: row.scanId,
      vulnerabilityId: row.vulnerabilityId ?? null,
      endpoint: row.endpoint,
      method: row.method,
      candidateVulnerabilities: (row.candidateVulnerabilities ?? []) as unknown as string[],
      priority: row.priority,
      recommendedTool: row.recommendedTool,
      reason: row.reason,
      requiresAuthentication: row.requiresAuthentication,
      estimatedRisk: row.estimatedRisk,
      verificationHints: (row.verificationHints ?? undefined) as unknown as import('../../../planner/domain/models/plan').TargetVerificationHints,
    };
  }

  async loadFindings(scanId: string): Promise<readonly CorrelatedFinding[]> {
    const rows = await prisma.vulnerability.findMany({
      where: { scanId },
      select: { id: true, vulnType: true, cweId: true, title: true, confidence: true, severity: true },
    });
    return rows.map((f) => ({
      id: f.id,
      vulnType: f.vulnType ?? f.title ?? null,
      cwe: f.cweId ?? null,
      confidence: f.confidence ?? 0,
      severity: f.severity,
    }));
  }

  async saveExploit(payload: SaveExploitPayload): Promise<ProofOfConcept> {
    const existing = await this.getExploitForTarget(payload.targetId, payload.type);

    const data = {
      scanId: payload.scanId,
      targetId: payload.targetId,
      vulnerabilityId: payload.vulnerabilityId ?? null,
      vulnerabilityType: payload.type,
      endpoint: payload.endpoint,
      method: payload.method,
      parameter: payload.parameter,
      tool: payload.tool,
      status: payload.status,
      confidence: payload.confidence,
      confidenceBreakdown: payload.confidenceBreakdown as unknown as object,
      statusReason: payload.reason,
      startedAt: payload.startedAt,
      completedAt: payload.completedAt,
      durationMs: payload.durationMs,
      errorMessage: payload.errorMessage ?? null,
    };

    // Replace evidence each run — the final status + its evidence is what a
    // reviewer sees; attempts carry the history.
    if (existing) {
      const row = await prisma.exploit.update({
        where: { id: existing.id },
        data,
      });
      await this.replaceEvidence(existing.id, payload.evidence);
      return mapExploitRow({
        ...row,
        evidence: payload.evidence as unknown as ExploitRow['evidence'],
        attacks: existing.attacks,
        _count: { attempts: existing.attacks },
      });
    }

    const created = await prisma.exploit.create({
      data: {
        ...data,
        evidence: { create: toEvidenceCreate(payload.evidence) },
      },
    });
    // Count real attempts — a single run may retry transient failures, so
    // the final Exploit must reflect every persisted VerificationAttempt.
    const attemptCount = await prisma.verificationAttempt.count({
      where: { exploitId: created.id },
    });
    return mapExploitRow({
      ...created,
      evidence: payload.evidence as unknown as ExploitRow['evidence'],
      attacks: attemptCount,
      _count: { attempts: attemptCount },
    });
  }

  async getExploitForTarget(
    targetId: string,
    type: VulnerabilityType
  ): Promise<ProofOfConcept | null> {
    const row = await prisma.exploit.findFirst({
      where: { targetId, vulnerabilityType: type },
      orderBy: { updatedAt: 'desc' },
      include: {
        evidence: { orderBy: { createdAt: 'asc' } },
        _count: { select: { attempts: true } },
      },
    });
    return row ? mapExploitRow(row as unknown as ExploitRow) : null;
  }

  async getExploit(id: string): Promise<ProofOfConcept | null> {
    const row = await prisma.exploit.findUnique({
      where: { id },
      include: {
        evidence: { orderBy: { createdAt: 'asc' } },
        _count: { select: { attempts: true } },
      },
    });
    return row ? mapExploitRow(row as unknown as ExploitRow) : null;
  }

  async listExploitsByTarget(targetId: string): Promise<readonly ProofOfConcept[]> {
    const rows = await prisma.exploit.findMany({
      where: { targetId },
      orderBy: { updatedAt: 'desc' },
      include: {
        evidence: { orderBy: { createdAt: 'asc' } },
        _count: { select: { attempts: true } },
      },
    });
    return rows.map((row) => mapExploitRow(row as unknown as ExploitRow));
  }

  async listAttempts(exploitId: string): Promise<readonly AttemptRecord[]> {
    const rows = await prisma.verificationAttempt.findMany({
      where: { exploitId },
      orderBy: { attemptNumber: 'asc' },
    });
    return rows.map(mapAttemptRow);
  }

  async saveAttempt(payload: SaveAttemptPayload): Promise<void> {
    await prisma.verificationAttempt.create({
      data: {
        exploitId: payload.exploitId,
        attemptNumber: payload.attemptNumber,
        verifier: payload.verifier,
        tool: payload.tool,
        status: payload.status,
        stdout: payload.stdout,
        stderr: payload.stderr,
        errorMessage: payload.errorMessage,
        exitCode: payload.exitCode,
        timedOut: payload.timedOut,
        retried: payload.retried,
        startedAt: payload.startedAt,
        completedAt: payload.completedAt,
        durationMs: payload.durationMs,
      },
    });
  }

  private async replaceEvidence(
    exploitId: string,
    evidence: readonly EvidenceItem[]
  ): Promise<void> {
    await prisma.exploitEvidence.deleteMany({ where: { exploitId } });
    if (evidence.length === 0) return;
    await prisma.exploitEvidence.createMany({
      data: evidence.map((e) => ({
        exploitId,
        indicator: e.indicator,
        category: e.category,
        httpStatus: e.httpStatus ?? null,
        detail: e.detail ?? null,
        confidenceFactor: e.confidenceFactor,
      })),
    });
  }
}