import { prisma } from '../../../config/database';
import type { AttackPlan, PlannedTarget, ScoreFactor } from '../../domain/models/plan';
import type { ProfileInput, StaticVulnInput, SurfaceInput } from '../../domain/models/plan-input';
import type { PlanRepository, PlannedPlanPayload } from '../../domain/ports/plan-repository';
import { summarizeTargets } from '../../application/ranking/plan-engine';

const FRAMEWORKS = ['Express', 'Next.js', 'Spring Boot', 'Django', 'Rails', 'Laravel', 'Flask'];

export function isExternalDocUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('docs.npmjs.com') ||
    lower.includes('owasp.org') ||
    lower.includes('github.com/advisories') ||
    lower.includes('nvd.nist.gov') ||
    lower.includes('cve.mitre.org') ||
    lower.includes('cve.org') ||
    lower.includes('npmjs.com/advisories') ||
    lower.includes('snyk.io') ||
    lower.includes('vulncode-db.com')
  );
}

/** Reads the planner's inputs from the existing scan/scout/vulnerability tables
 * and persists the generated plan. Read-mostly; nothing executes. */
export class PrismaPlanRepository implements PlanRepository {
  async scanExists(scanId: string): Promise<boolean> {
    const scan = await prisma.scan.findUnique({ where: { id: scanId }, select: { id: true } });
    return scan !== null;
  }

  async loadStaticFindings(scanId: string): Promise<readonly StaticVulnInput[]> {
    const rows = await prisma.vulnerability.findMany({ where: { scanId } });
    return rows.map((f) => ({
      id: f.id,
      vulnerabilityId: f.id,
      type: f.vulnType ?? f.scanner ?? 'unknown',
      severity: f.severity,
      cwe: f.cweId,
      cve: f.cve ?? null,
      confidence: f.confidence ?? 0,
      message: f.message ?? f.title,
      filePath: f.filePath ?? null,
    }));
  }

  async loadAttackSurface(scanId: string): Promise<readonly SurfaceInput[]> {
    const latest = await prisma.scoutScan.findFirst({
      where: { scanId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      include: { surfaces: { orderBy: { createdAt: 'asc' } } },
    });
    if (!latest) return [];
    return latest.surfaces
      .filter((s) => !isExternalDocUrl(s.url))
      .map((s) => ({
        url: s.url,
        method: s.method,
        parameters: (s.parameters ?? []) as string[],
        authentication: s.authentication,
        risk: s.risk,
        source: s.source,
        statusCode: s.statusCode,
      }));
  }

  async loadProfile(scanId: string): Promise<ProfileInput> {
    const scan = await prisma.scan.findUnique({
      where: { id: scanId },
      include: {
        repositories: { include: { repository: true }, take: 1 },
        scoutScans: {
          where: { status: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { technologies: true },
        },
      },
    });
    const repo = scan?.repositories[0]?.repository ?? null;
    const technologies = scan?.scoutScans[0]?.technologies.map((t) => t.name) ?? [];
    const framework = technologies.find((t) => FRAMEWORKS.includes(t)) ?? null;
    return {
      language: repo?.language ?? null,
      framework,
      technologies,
    };
  }

  async savePlan(payload: PlannedPlanPayload): Promise<AttackPlan> {
    const { scanId, plan } = payload;
    const created = await prisma.attackPlan.create({
      data: {
        scanId,
        coveredSurfaces: plan.coveredSurfaces,
        coveredFindings: plan.coveredFindings,
        summary: plan.summary as object,
        targets: {
          create: plan.targets.map((t) => ({
            scanId,
            targetId: t.targetId,
            vulnerabilityId: t.vulnerabilityId ?? null,
            endpoint: t.endpoint,
            method: t.method,
            candidateVulnerabilities: t.candidateVulnerabilities as unknown as string[],
            priority: t.priority,
            recommendedTool: t.recommendedTool,
            reason: t.reason,
            requiresAuthentication: t.requiresAuthentication,
            estimatedRisk: t.estimatedRisk,
            breakdown: t.breakdown as unknown as Array<{ label: string; points: number }>,
            verificationHints: (t.verificationHints ?? null) as unknown as object,
          })),
        },
      },
    });
    // Targets are already ranked by the engine; return the persisted plan.
    return {
      id: created.id,
      scanId,
      createdAt: created.createdAt.toISOString(),
      coveredSurfaces: plan.coveredSurfaces,
      coveredFindings: plan.coveredFindings,
      summary: plan.summary,
      targets: [...plan.targets].sort((a, b) => b.priority - a.priority),
    };
  }

  async getPlan(planId: string): Promise<AttackPlan | null> {
    const row = await prisma.attackPlan.findUnique({
      where: { id: planId },
      include: { targets: { orderBy: { priority: 'desc' } } },
    });
    if (!row) return null;

    const exploits = await prisma.exploit.findMany({
      where: { scanId: row.scanId },
      select: { targetId: true, status: true, statusReason: true, errorMessage: true, toolSummary: true },
    });

    const exploitMap = new Map<string, { status: string; reason?: string }>();
    exploits.forEach((e) => {
      if (e.targetId) {
        exploitMap.set(e.targetId, {
          status: e.status,
          reason: e.statusReason ?? e.errorMessage ?? e.toolSummary ?? undefined,
        });
      }
    });

    return this.map(row, exploitMap);
  }

  async getPlanForScan(scanId: string): Promise<AttackPlan | null> {
    const row = await prisma.attackPlan.findFirst({
      where: { scanId },
      orderBy: { createdAt: 'desc' },
      include: { targets: { orderBy: { priority: 'desc' } } },
    });
    if (!row) return null;

    const exploits = await prisma.exploit.findMany({
      where: { scanId },
      select: { targetId: true, status: true, statusReason: true, errorMessage: true, toolSummary: true },
    });

    const exploitMap = new Map<string, { status: string; reason?: string }>();
    exploits.forEach((e) => {
      if (e.targetId) {
        exploitMap.set(e.targetId, {
          status: e.status,
          reason: e.statusReason ?? e.errorMessage ?? e.toolSummary ?? undefined,
        });
      }
    });

    return this.map(row, exploitMap);
  }

  private map(row: PlanRow, exploitMap?: Map<string, { status: string; reason?: string }>): AttackPlan {
    return {
      id: row.id,
      scanId: row.scanId,
      createdAt: row.createdAt.toISOString(),
      coveredSurfaces: row.coveredSurfaces,
      coveredFindings: row.coveredFindings,
      summary: (row.summary ?? { targets: 0, critical: 0, high: 0, medium: 0, low: 0 }) as AttackPlan['summary'],
      targets: row.targets.map((t) => mapTarget(t, exploitMap?.get(t.targetId))),
    };
  }
}

function mapTarget(t: RawTargetRow, exploit?: { status: string; reason?: string }): PlannedTarget {
  return {
    targetId: t.targetId,
    vulnerabilityId: t.vulnerabilityId ?? undefined,
    endpoint: t.endpoint,
    method: t.method,
    candidateVulnerabilities: (t.candidateVulnerabilities ?? []) as unknown as string[],
    priority: t.priority,
    recommendedTool: t.recommendedTool,
    reason: t.reason,
    requiresAuthentication: t.requiresAuthentication,
    estimatedRisk: t.estimatedRisk as PlannedTarget['estimatedRisk'],
    breakdown: (t.breakdown ?? []) as unknown as ScoreFactor[],
    verificationHints: (t.verificationHints ?? undefined) as unknown as PlannedTarget['verificationHints'],
    verificationStatus: exploit?.status ?? 'NOT_RUN',
    verificationReason: exploit?.reason,
  };
}

type RawTargetRow = {
  targetId: string;
  vulnerabilityId?: string | null;
  endpoint: string;
  method: string;
  candidateVulnerabilities: unknown;
  priority: number;
  recommendedTool: string;
  reason: string;
  requiresAuthentication: boolean;
  estimatedRisk: string;
  breakdown: unknown;
  verificationHints?: unknown;
};

type PlanRow = {
  id: string;
  scanId: string;
  createdAt: Date;
  coveredSurfaces: number;
  coveredFindings: number;
  summary: unknown;
  targets: readonly RawTargetRow[];
};
