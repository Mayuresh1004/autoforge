import type { Prisma } from '@prisma/client';
import { prisma } from '../../../../config/database';
import type { ScanRepository } from '../../../domain/ports/scan-repository';
import type {
  CompleteScanInput,
  CreateScanInput,
} from '../../../domain/ports/scan-repository';
import type {
  ScanStatus,
  ScannerStatistics,
  ScannerRunStatus,
  StoredFinding,
  StoredRepository,
  StoredScan,
} from '../../../domain/models/scan';
import type { Severity } from '../../../domain/models/severity';
import type { UnifiedFinding } from '../../../domain/models/finding';

/**
 * Prisma-backed persistence adapter for scans and findings. Maps the Unified
 * Vulnerability Model onto the existing `Scan` / `Repository` tables and the
 * (extended) `Vulnerability` table.
 */
export class PrismaScanRepository implements ScanRepository {
  async upsertRepository(input: {
    url: string;
    name: string;
    branch: string;
  }): Promise<StoredRepository> {
    const row = await prisma.repository.upsert({
      where: { url_branch: { url: input.url, branch: input.branch } },
      update: { name: input.name },
      create: { url: input.url, name: input.name, branch: input.branch },
    });
    return { id: row.id, name: row.name, url: row.url, branch: row.branch };
  }

  async createScan(input: CreateScanInput): Promise<StoredScan> {
    const repo = await this.upsertRepository({
      url: input.repositoryUrl,
      name: input.name,
      branch: 'main',
    }).catch(() => null);

    const row = await prisma.scan.create({
      data: { name: input.name, status: 'PENDING' },
    });

    if (repo) {
      await this.linkScanRepository(row.id, repo.id).catch(() => undefined);
    }
    return toStoredScan(row, repo ?? undefined);
  }

  async linkScanRepository(scanId: string, repositoryId: string): Promise<void> {
    await prisma.scanRepository.upsert({
      where: { scanId_repositoryId: { scanId, repositoryId } },
      update: {},
      create: { scanId, repositoryId },
    });
  }

  async markScanRunning(scanId: string, startedAt: Date): Promise<void> {
    await prisma.scan.update({ where: { id: scanId }, data: { status: 'RUNNING', startedAt } });
  }

  async completeScan(scanId: string, input: CompleteScanInput): Promise<void> {
    await prisma.scan.update({
      where: { id: scanId },
      data: {
        status: input.status,
        completedAt: input.completedAt,
        scannerStats: input.scannerStats as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async saveFindings(scanId: string, findings: readonly UnifiedFinding[]): Promise<number> {
    if (findings.length === 0) return 0;
    await prisma.vulnerability.createMany({
      data: findings.map((finding) => ({
        scanId,
        title: finding.type,
        description: finding.message,
        severity: finding.severity,
        status: 'DETECTED',
        filePath: finding.file,
        lineNumber: finding.line,
        cweId: finding.cwe,
        cve: finding.cve,
        scanner: finding.scanner,
        vulnType: finding.type,
        confidence: finding.confidence,
        references: finding.references as Prisma.InputJsonValue,
        evidence: finding.evidence,
      })),
    });
    return findings.length;
  }

  async getScan(scanId: string): Promise<StoredScan | null> {
    const row = await prisma.scan.findUnique({
      where: { id: scanId },
      include: { repositories: { include: { repository: true }, take: 1 } },
    });
    if (!row) return null;
    const repo = row.repositories[0]?.repository;
    return toStoredScan(row, repo ? { id: repo.id, name: repo.name, url: repo.url, branch: repo.branch } : undefined);
  }

  async getScanResults(
    scanId: string
  ): Promise<{ scan: StoredScan; findings: readonly StoredFinding[] } | null> {
    const scan = await this.getScan(scanId);
    if (!scan) return null;
    const rows = await prisma.vulnerability.findMany({
      where: { scanId },
      include: { patches: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return { scan, findings: rows.map(toStoredFinding) };
  }
}

function toStoredScan(
  row: {
    id: string;
    name: string;
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    scannerStats: Prisma.JsonValue | null;
  },
  repository?: StoredRepository
): StoredScan {
  return {
    id: row.id,
    name: row.name,
    status: (row.status ?? 'PENDING') as ScanStatus,
    startedAt: row.startedAt ?? row.createdAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    scannerStats: toScannerStats(row.scannerStats),
    repository: repository ?? null,
  };
}

function toScannerStats(value: Prisma.JsonValue | null): ScannerStatistics[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter(isScannerStat).map((item) => ({
    scannerId: String(item.scannerId),
    engine: String(item.engine),
    status: String(item.status) as ScannerRunStatus,
    durationMs: Number(item.durationMs),
    findings: Number(item.findings),
  }));
}

function isScannerStat(value: unknown): value is {
  scannerId: unknown;
  engine: unknown;
  status: unknown;
  durationMs: unknown;
  findings: unknown;
} {
  return typeof value === 'object' && value !== null && 'scannerId' in value && 'engine' in value;
}

function toStoredFinding(row: {
  id: string;
  scanId: string;
  scanner: string | null;
  vulnType: string | null;
  title: string;
  severity: Severity;
  status?: string | null;
  confidence: number | null;
  filePath: string | null;
  lineNumber: number | null;
  cweId: string | null;
  cve: string | null;
  references: Prisma.JsonValue | null;
  evidence: string | null;
  message: string | null;
  description: string | null;
  createdAt: Date;
  patches?: Array<{
    id: string;
    filePath: string | null;
    diffContent: string | null;
    explanation: string | null;
    status: string;
  }>;
}): StoredFinding {
  const latestPatch = row.patches && row.patches.length > 0 ? row.patches[0] : null;
  return {
    id: row.id,
    scanId: row.scanId,
    scanner: row.scanner ?? 'unknown',
    type: row.vulnType ?? row.title ?? 'unknown',
    severity: row.severity ?? 'INFO',
    status: row.status ?? 'DETECTED',
    confidence: row.confidence ?? 0.5,
    file: row.filePath,
    line: row.lineNumber,
    message: row.message ?? row.description ?? '',
    cwe: row.cweId,
    cve: row.cve,
    references: toReferences(row.references),
    evidence: row.evidence,
    createdAt: row.createdAt ?? new Date(),
    patch: latestPatch
      ? {
          id: latestPatch.id,
          filePath: latestPatch.filePath,
          diffContent: latestPatch.diffContent,
          explanation: latestPatch.explanation,
          status: latestPatch.status,
        }
      : null,
  };
}

function toReferences(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}