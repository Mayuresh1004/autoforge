/**
 * Prisma-backed Critic finding resolver. Yields the exact CONFIRMED
 * SQL_INJECTION exploit (and its planned target id) behind an
 * Engineer-generated patch — reused from the SHARED confirmed-finding
 * source (src/remediation) so the Critic retest hits the SAME target the
 * original confirmation used and sees the SAME finding the Engineer saw.
 * Returns null (unreviewable) otherwise.
 */

import type { PrismaClient } from '@prisma/client';
import type { CriticFindingResolver, CriticPatchContext } from '../../domain/ports/critic-finding-resolver';
import { PrismaConfirmedFindingSource } from '../../../remediation/infrastructure/prisma-confirmed-finding-source';
import { REMEDIATION_CONFIRMED_STATUS } from '../../../remediation/domain/ports/confirmed-finding-source';

export class PrismaCriticFindingResolver implements CriticFindingResolver {
  private readonly source: PrismaConfirmedFindingSource;
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.source = new PrismaConfirmedFindingSource(prisma);
    this.prisma = prisma;
  }

  async resolveForPatch(patchId: string): Promise<CriticPatchContext | null> {
    const patch = await this.prisma.patch.findUnique({ where: { id: patchId }, select: { vulnerabilityId: true } });
    if (!patch || !patch.vulnerabilityId) return null;

    const payload = await this.source.findByVulnerabilityId({ vulnerabilityId: patch.vulnerabilityId });
    if (!payload) return null;
    if (payload.vulnerabilityStatus !== REMEDIATION_CONFIRMED_STATUS) return null;
    if (!payload.exploitTargetId) return null;

    return {
      finding: payload,
      exploitTargetId: payload.exploitTargetId,
      endpoint: payload.endpoint ?? '',
      method: payload.method ?? '',
    };
  }
}