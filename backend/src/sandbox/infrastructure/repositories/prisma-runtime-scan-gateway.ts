import type { PrismaClient } from '@prisma/client';
import type { RuntimeRepositoryRef } from '../../domain/entities/runtime-sandbox';
import type { RuntimeScanGateway } from '../../domain/ports/runtime-scan-gateway';

/**
 * Scan/repository validation against the durable layer: a sandbox may only
 * be provisioned for an existing scan, and — when the scan has repositories
 * linked — only for one of those repositories.
 */
export class PrismaRuntimeScanGateway implements RuntimeScanGateway {
  constructor(private readonly db: PrismaClient) {}

  async scanExists(scanId: string): Promise<boolean> {
    const scan = await this.db.scan.findUnique({ where: { id: scanId }, select: { id: true } });
    return scan !== null;
  }

  async scanRepositoryRelation(
    scanId: string,
    repository: RuntimeRepositoryRef
  ): Promise<boolean | null> {
    const links = await this.db.scanRepository.findMany({
      where: { scanId },
      include: { repository: { select: { url: true } } },
    });
    if (links.length === 0) return null; // scan has no linked repos — allowed, recorded

    if (repository.url) {
      return links.some((link) => sameUrl(link.repository.url, repository.url!));
    }
    if (repository.path) {
      // Local paths cannot be matched to a DB URL — trusted only when the
      // caller explicitly attached them to the scan (repository relation by URL).
      return null;
    }
    return false;
  }
}

function sameUrl(left: string, right: string): boolean {
  return normalizeUrl(left) === normalizeUrl(right);
}

function normalizeUrl(value: string): string {
  return value.trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
}