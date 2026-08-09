/**
 * Engineer confirmed-finding repository — thin facade over the SHARED
 * `PrismaConfirmedFindingSource` (see `src/remediation/`). The query, the
 * mapping and the redaction policy live ONCE in the shared source; this
 * adapter only scopes its port's calls to a scan.
 */

import type { PrismaClient } from '@prisma/client';
import type { ConfirmedVulnerabilityFinding } from '../../../remediation/domain/models/confirmed-finding';
import { PrismaConfirmedFindingSource } from '../../../remediation/infrastructure/prisma-confirmed-finding-source';
import type { ConfirmedFindingRepository } from '../../domain/ports/confirmed-finding-repository';

export class PrismaConfirmedFindingRepository implements ConfirmedFindingRepository {
  private readonly source: PrismaConfirmedFindingSource;

  constructor(prisma: PrismaClient) {
    this.source = new PrismaConfirmedFindingSource(prisma);
  }

  async listConfirmed(scanId: string): Promise<readonly ConfirmedVulnerabilityFinding[]> {
    return this.source.listConfirmed(scanId);
  }

  async findByVulnerabilityId(
    scanId: string,
    vulnerabilityId: string,
  ): Promise<ConfirmedVulnerabilityFinding | null> {
    return this.source.findByVulnerabilityId({ scanId, vulnerabilityId });
  }
}