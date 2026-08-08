import { prisma } from '../../../config/database';
import type {
  AttackSurfaceEntry,
  DetectedTechnology,
  DiscoveredService,
  OpenPort,
} from '../../domain/models/attack-surface';
import type {
  PersistScoutRun,
  ScoutContext,
  ScoutQueryResult,
  ScoutRepository,
} from '../../domain/ports/scout-repository';
import type { ScoutScanRecord, ScoutSummary } from '../../domain/models/scout-scan';

/** Prisma adapter for Scout recon persistence. */
export class PrismaScoutRepository implements ScoutRepository {
  async getContext(scanId: string): Promise<ScoutContext | null> {
    const scan = await prisma.scan.findUnique({
      where: { id: scanId },
      include: {
        repositories: { include: { repository: true }, take: 1 },
        _count: { select: { vulnerabilities: true } },
      },
    });
    if (!scan) return null;
    const repo = scan.repositories[0]?.repository ?? null;
    return {
      scanId: scan.id,
      scanStatus: scan.status,
      repositoryName: repo?.name ?? null,
      repositoryUrl: repo?.url ?? null,
      staticFindings: scan._count.vulnerabilities,
    };
  }

  async createScoutScan(input: {
    readonly scanId: string;
    readonly targetUrl: string;
  }): Promise<ScoutScanRecord> {
    const row = await prisma.scoutScan.create({
      data: { scanId: input.scanId, targetUrl: input.targetUrl },
    });
    return mapScoutScan(row);
  }

  async markRunning(scoutScanId: string, startedAt: Date): Promise<void> {
    await prisma.scoutScan.update({
      where: { id: scoutScanId },
      data: { status: 'RUNNING', startedAt },
    });
  }

  async completeScoutScan(
    scoutScanId: string,
    status: 'COMPLETED' | 'FAILED',
    summary: ScoutSummary,
    completedAt: Date,
  ): Promise<void> {
    await prisma.scoutScan.update({
      where: { id: scoutScanId },
      data: { status, summary: summary as object, completedAt },
    });
  }

  async persist(scoutScanId: string, run: PersistScoutRun): Promise<void> {
    await prisma.scoutAttackSurface.createMany({
      data: run.attackSurface.map((e) => ({
        id: e.id,
        scoutScanId,
        url: e.url,
        method: e.method,
        parameters: e.parameters as unknown as string[],
        authentication: e.authentication,
        technology: e.technology as unknown as string[],
        risk: e.risk,
        source: e.source,
        reachable: e.reachable,
        statusCode: e.statusCode,
      })),
    });
    await prisma.scoutTechnology.createMany({
      data: run.technologies.map((t) => ({
        scoutScanId,
        name: t.name,
        category: t.category,
        version: t.version,
        confidence: t.confidence,
        evidence: t.evidence,
      })),
    });
    await prisma.scoutPort.createMany({
      data: run.ports.map((p) => ({
        scoutScanId,
        port: p.port,
        protocol: p.protocol,
        state: p.state,
        service: p.service,
      })),
    });
    await prisma.scoutService.createMany({
      data: run.services.map((s) => ({
        scoutScanId,
        name: s.name,
        protocol: s.protocol,
        port: s.port,
        version: s.version,
        evidence: s.evidence,
      })),
    });
  }

  async getScoutScan(scoutScanId: string): Promise<ScoutQueryResult | null> {
    const row = await prisma.scoutScan.findUnique({
      where: { id: scoutScanId },
      include: {
        surfaces: { orderBy: { createdAt: 'asc' } },
        technologies: { orderBy: { createdAt: 'asc' } },
        ports: { orderBy: { port: 'asc' } },
        services: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) return null;
    return {
      scoutScan: mapScoutScan(row),
      attackSurface: row.surfaces.map(mapSurface),
      technologies: row.technologies.map(mapTechnology),
      ports: row.ports.map(mapPort),
      services: row.services.map(mapService),
    };
  }

  async listScoutScans(scanId: string): Promise<ScoutScanRecord[]> {
    const rows = await prisma.scoutScan.findMany({
      where: { scanId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapScoutScan);
  }
}

function mapScoutScan(row: {
  id: string;
  scanId: string;
  targetUrl: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  summary: unknown;
  createdAt: Date;
}): ScoutScanRecord {
  return {
    id: row.id,
    scanId: row.scanId,
    targetUrl: row.targetUrl,
    status: row.status as ScoutScanRecord['status'],
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    summary: (row.summary ?? null) as ScoutSummary | null,
    createdAt: row.createdAt,
  };
}

function mapSurface(s: {
  id: string;
  url: string;
  method: string;
  parameters: unknown;
  authentication: boolean;
  technology: unknown;
  risk: string;
  source: string;
  reachable: boolean;
  statusCode: number | null;
}): AttackSurfaceEntry {
  return {
    id: s.id,
    url: s.url,
    method: s.method as AttackSurfaceEntry['method'],
    parameters: (s.parameters ?? []) as string[],
    authentication: s.authentication,
    technology: (s.technology ?? []) as string[],
    risk: s.risk as AttackSurfaceEntry['risk'],
    source: s.source as AttackSurfaceEntry['source'],
    reachable: s.reachable,
    statusCode: s.statusCode,
  };
}

function mapTechnology(t: {
  name: string;
  category: string;
  version: string | null;
  confidence: number;
  evidence: string | null;
}): DetectedTechnology {
  return {
    name: t.name,
    category: t.category,
    version: t.version,
    confidence: t.confidence,
    evidence: t.evidence ?? '',
  };
}

function mapPort(p: {
  port: number;
  protocol: string;
  state: string;
  service: string | null;
}): OpenPort {
  return {
    port: p.port,
    protocol: p.protocol,
    state: p.state as OpenPort['state'],
    service: p.service,
  };
}

function mapService(s: {
  name: string;
  protocol: string;
  port: number | null;
  version: string | null;
  evidence: string | null;
}): DiscoveredService {
  return {
    name: s.name,
    protocol: s.protocol,
    port: s.port,
    version: s.version,
    evidence: s.evidence,
  };
}