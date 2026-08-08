/**
 * Prisma-backed Engineer patch repository. Uses the EXISTING `Patch` model
 * (no new table, no migration). Only GENERATED / REJECTED states are ever
 * written here — APPROVED / APPLIED / VALIDATED belong to later phases.
 */

import type { PrismaClient } from '@prisma/client';
import type {
  EngineerPatchRecord,
  EngineerPatchRepository,
  SaveEngineerPatchInput,
} from '../../domain/ports/patch-repository';

export class PrismaEngineerPatchRepository implements EngineerPatchRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async saveGeneratedPatch(input: SaveEngineerPatchInput): Promise<EngineerPatchRecord> {
    const row = await this.prisma.patch.create({
      data: {
        vulnerabilityId: input.vulnerabilityId,
        status: input.status as never,
        diffContent: input.diffContent,
        filePath: input.filePath,
        explanation: input.explanation,
        validatedAt: input.validatedAt ?? null,
      },
    });
    return this.mapRow(row);
  }

  async getById(id: string): Promise<EngineerPatchRecord | null> {
    const row = await this.prisma.patch.findUnique({ where: { id } });
    return row ? this.mapRow(row) : null;
  }

  async getByVulnerabilityId(vulnerabilityId: string): Promise<EngineerPatchRecord | null> {
    const row = await this.prisma.patch.findFirst({
      where: { vulnerabilityId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: {
    id: string;
    vulnerabilityId: string;
    status: string;
    diffContent: string | null;
    filePath: string | null;
    explanation: string | null;
    createdAt: Date;
  }): EngineerPatchRecord {
    return {
      id: row.id,
      vulnerabilityId: row.vulnerabilityId,
      status: row.status === 'REJECTED' ? 'REJECTED' : 'GENERATED',
      filePath: row.filePath,
      diffContent: row.diffContent,
      explanation: row.explanation ?? '',
      createdAt: row.createdAt.toISOString(),
    };
  }
}