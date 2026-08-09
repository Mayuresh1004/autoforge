/**
 * Prisma-backed patch review repository — the ONLY seam that transitions a
 * patch's status for the Critic. Works over the EXISTING `Patch` model:
 *
 *   GENERATED → UNDER_REVIEW → APPROVED | REJECTED
 *
 * Transitions are narrow and deterministic: only GENERATED (or already
 * UNDER_REVIEW) patches may be marked; APPROVED/REJECTED are terminal.
 */

import type { PrismaClient } from '@prisma/client';
import type {
  PatchReviewRepository,
  ReviewablePatch,
  ReviewablePatchStatus,
} from '../../domain/ports/patch-review-repository';

const REVIEWABLE = ['GENERATED', 'UNDER_REVIEW'] as const;

export class PrismaPatchReviewRepository implements PatchReviewRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getPatch(patchId: string): Promise<ReviewablePatch | null> {
    const row = await this.prisma.patch.findUnique({ where: { id: patchId } });
    if (!row) return null;
    const status = toReviewablePatchStatus(row.status as string);
    if (!status) return null;
    return {
      id: row.id,
      vulnerabilityId: row.vulnerabilityId,
      status,
      filePath: row.filePath,
      diffContent: row.diffContent,
      explanation: row.explanation,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async markUnderReview(patchId: string): Promise<void> {
    await this.prisma.patch.updateMany({
      where: { id: patchId, status: { in: ['GENERATED', 'UNDER_REVIEW'] } },
      data: { status: 'UNDER_REVIEW' },
    });
  }

  async setVerdict(patchId: string, verdict: 'APPROVED' | 'REJECTED'): Promise<void> {
    await this.prisma.patch.updateMany({
      where: { id: patchId, status: { in: ['GENERATED', 'UNDER_REVIEW'] } },
      data: { status: verdict, validatedAt: new Date() },
    });
  }
}

function toReviewablePatchStatus(status: string): ReviewablePatchStatus | null {
  switch (status) {
    case 'GENERATED':
    case 'UNDER_REVIEW':
    case 'APPROVED':
    case 'REJECTED':
      return status;
    default:
      return null;
  }
}