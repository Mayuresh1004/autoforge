/**
 * Prisma-backed confirmed-finding source — the ONE place that resolves
 * CONFIRMED SQL_INJECTION exploits for both the Engineer and the Critic.
 *
 * Everything is a read of the EXISTING schema: Exploit → Vulnerability →
 * attempts (depth) → evidence (redacted summaries). Data sanitization lives
 * here once: evidence/details are truncated summaries — never raw response
 * bodies, never secrets.
 */

import type { PrismaClient } from '@prisma/client';
import type { ConfirmedFindingPayload } from '../domain/models/confirmed-finding';
import type { ConfirmedFindingSource } from '../domain/ports/confirmed-finding-source';
import {
  REMEDIATION_CONFIRMED_STATUS,
  REMEDIATION_SUPPORTED_TYPE,
} from '../domain/ports/confirmed-finding-source';

export class PrismaConfirmedFindingSource implements ConfirmedFindingSource {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async listConfirmed(scanId: string): Promise<readonly ConfirmedFindingPayload[]> {
    const rows = await this.queryExploits({ scanId });
    return rows
      .filter(
        (row) =>
          (row as MappingRow).vulnerability !== null &&
          (row as MappingRow).vulnerabilityId !== null
      )
      .map((row) => mapConfirmedFinding(row as unknown as MappingRow));
  }

  async findByVulnerabilityId(input: {
    readonly scanId?: string;
    readonly vulnerabilityId: string;
  }): Promise<ConfirmedFindingPayload | null> {
    const rows = await this.queryExploits({
      scanId: input.scanId,
      vulnerabilityId: input.vulnerabilityId,
    });
    const row = rows[0];
    if (!row || !(row as MappingRow).vulnerability || !(row as MappingRow).vulnerabilityId) return null;
    return mapConfirmedFinding(row as unknown as MappingRow);
  }

  private async queryExploits(where: { scanId?: string; vulnerabilityId?: string }): Promise<unknown[]> {
    return this.prisma.exploit.findMany({
      where: {
        ...(where.scanId !== undefined ? { scanId: where.scanId } : {}),
        ...(where.vulnerabilityId !== undefined ? { vulnerabilityId: where.vulnerabilityId } : {}),
        status: REMEDIATION_CONFIRMED_STATUS,
        vulnerabilityType: REMEDIATION_SUPPORTED_TYPE,
      },
      include: {
        vulnerability: true,
        attempts: { select: { id: true } },
        evidence: { select: { indicator: true, category: true, detail: true } },
      },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
    }) as Promise<unknown[]>;
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
  targetId: string | null;
  createdAt: Date;
  completedAt: Date | null;
  vulnerability: {
    severity?: string | null;
    cweId?: string | null;
    cve?: string | null;
    title?: string | null;
    message?: string | null;
    filePath?: string | null;
    lineNumber?: number | null;
    status?: string | null;
  } | null;
  attempts: readonly { id: string }[];
  evidence: readonly { indicator: string; category: string; detail: string | null }[];
};

export function normalizeTargetEndpoint(
  rawEndpoint: string | null,
  rawParam: string | null,
  rawMethod: string | null,
): { endpoint: string | null; method: string; parameter: string | null } {
  const method = (rawMethod ?? 'GET').toUpperCase();
  if (!rawEndpoint) {
    return { endpoint: null, method, parameter: rawParam ?? null };
  }
  let endpointPath: string | null = null;
  let parameter: string | null = rawParam ?? null;

  try {
    let urlString = rawEndpoint.trim();
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
      urlString = `http://localhost${urlString.startsWith('/') ? '' : '/'}${urlString}`;
    }
    const parsed = new URL(urlString);
    endpointPath = parsed.pathname;
    if (!parameter && parsed.searchParams.size > 0) {
      parameter = Array.from(parsed.searchParams.keys())[0] ?? null;
    }
  } catch {
    const withoutQuery = rawEndpoint.split('?')[0].trim();
    const slash = withoutQuery.indexOf('/');
    if (slash !== -1) {
      endpointPath = withoutQuery.slice(slash);
    } else {
      endpointPath = withoutQuery;
    }
  }

  return { endpoint: endpointPath, method, parameter };
}

/** Pure mapping (exported for tests): exploit + vulnerability → payload. */
export function mapConfirmedFinding(row: MappingRow): ConfirmedFindingPayload {
  const vuln = row.vulnerability ?? {};
  const evidence = row.evidence
    .map((e) => `${e.indicator}${e.detail ? `: ${e.detail.slice(0, 300)}` : ''}`)
    .slice(0, 5)
    .join('; ');
  const normalized = normalizeTargetEndpoint(row.endpoint ?? null, row.parameter ?? null, row.method ?? null);

  return {
    vulnerabilityId: row.vulnerabilityId,
    scanId: row.scanId,
    exploitId: row.id,
    type: 'SQL_INJECTION',
    status: 'CONFIRMED',
    severity: (vuln.severity ?? 'MEDIUM') as ConfirmedFindingPayload['severity'],
    confidence: row.confidence ?? 0,
    cwe: vuln.cweId ?? null,
    cve: vuln.cve ?? null,
    title: vuln.title ?? null,
    message: vuln.message ?? null,
    filePath: vuln.filePath ?? null,
    lineNumber: vuln.lineNumber ?? null,
    endpoint: normalized.endpoint,
    method: normalized.method,
    parameter: normalized.parameter,
    evidence: evidence.length > 0 ? evidence.slice(0, 1_000) : null,
    reason: row.reason ? row.reason.slice(0, 500) : null,
    exploitDepth: row.attempts.length,
    confirmedAt: (row.completedAt ?? row.createdAt).toISOString(),
    exploitTargetId: row.targetId ?? '',
    vulnerabilityStatus: vuln.status ?? null,
  };
}