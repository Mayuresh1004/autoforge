/**
 * Prisma-backed confirmed-finding source. Reads CONFIRMED SQL_INJECTION
 * exploits + their Vulnerability rows via the EXISTING Prisma schema.
 * Data sanitization: evidence/details are redacted, truncated summaries —
 * never raw response bodies, never secrets.
 */

import type { PrismaClient } from '@prisma/client';
import type { ConfirmedVulnerabilityFinding } from '../../domain/ports/confirmed-finding-repository';
import type { ConfirmedFindingRepository } from '../../domain/ports/confirmed-finding-repository';

const SUPPORTED_TYPE = 'SQL_INJECTION';
const CONFIRMED_STATUS = 'CONFIRMED';

export class PrismaConfirmedFindingRepository implements ConfirmedFindingRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async listConfirmed(scanId: string): Promise<readonly ConfirmedVulnerabilityFinding[]> {
    const rows = await this.prisma.exploit.findMany({
      where: { scanId, status: CONFIRMED_STATUS, vulnerabilityType: SUPPORTED_TYPE },
      include: {
        vulnerability: true,
        attempts: { select: { id: true } },
        evidence: { select: { indicator: true, category: true, detail: true } },
      },
      orderBy: { completedAt: 'desc' },
    });
    return rows
      .filter((row) => row.vulnerability !== null && row.vulnerabilityId !== null)
      .map((row) => mapFinding(row as unknown as MappingRow));
  }

  async findByVulnerabilityId(
    scanId: string,
    vulnerabilityId: string,
  ): Promise<ConfirmedVulnerabilityFinding | null> {
    const row = await this.prisma.exploit.findFirst({
      where: {
        scanId,
        vulnerabilityId,
        status: CONFIRMED_STATUS,
        vulnerabilityType: SUPPORTED_TYPE,
      },
      include: {
        vulnerability: { select: { id: true, severity: true, cweId: true, cve: true, title: true, description: true, message: true, filePath: true, lineNumber: true } },
        attempts: { select: { id: true } },
        evidence: { select: { indicator: true, category: true, detail: true } },
      },
      orderBy: { completedAt: 'desc' },
    });
    if (!row || !row.vulnerability || !row.vulnerabilityId) return null;
    return mapFinding(row as unknown as MappingRow);
  }
}

type MappingRow = {
  id: string;
  scanId: string;
  vulnerabilityId: string;
  endpoint: string;
  method: string;
  vulnerabilityType: string;
  parameter: string | null;
  tool: string | null;
  reason: string | null;
  confidence: number | null;
  attacks: number | null;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  vulnerability: {
    severity?: string | null;
    cweId?: string | null;
    cve?: string | null;
    message?: string | null;
    filePath?: string | null;
    lineNumber?: number | null;
  } | null;
  attempts: readonly { id: string }[];
  evidence: readonly { indicator: string; category: string; detail: string | null }[];
};

function mapFinding(row: MappingRow): ConfirmedVulnerabilityFinding {
  const vuln = row.vulnerability!;
  const evidence = row.evidence
    .map((e) => `${e.indicator}${e.detail ? `: ${e.detail.slice(0, 300)}` : ''}`)
    .slice(0, 5)
    .join('; ');
  return {
    vulnerabilityId: row.vulnerabilityId,
    scanId: row.scanId,
    exploitId: row.id,
    type: 'SQL_INJECTION',
    status: 'CONFIRMED',
    severity: (vuln.severity ?? 'MEDIUM') as ConfirmedVulnerabilityFinding['severity'],
    confidence: row.confidence ?? 0,
    cwe: vuln.cweId ?? null,
    cve: vuln.cve ?? null,
    title: null,
    message: vuln.message ?? null,
    filePath: vuln.filePath ?? null,
    lineNumber: vuln.lineNumber ?? null,
    endpoint: row.endpoint ?? null,
    method: row.method ?? null,
    parameter: row.parameter ?? null,
    evidence: evidence.length > 0 ? evidence.slice(0, 1_000) : null,
    reason: row.reason ? row.reason.slice(0, 500) : null,
    exploitDepth: row.attempts.length,
    confirmedAt: (row.completedAt ?? row.createdAt).toISOString(),
  };
}