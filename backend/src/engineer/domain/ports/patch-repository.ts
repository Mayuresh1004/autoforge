/**
 * Engineer persistence port — the ONLY way the Engineer writes patches.
 * Implemented on the existing Prisma `Patch` model (no new table). Engineer
 * NEVER marks patches APPROVED / APPLIED / VALIDATED here — those states
 * belong to later phases (status is fixed to GENERATED or REJECTED).
 */

import type { EngineerPatchStatus } from '../../domain/models/engineer-response';

export interface SaveEngineerPatchInput {
  readonly vulnerabilityId: string;
  readonly status: EngineerPatchStatus;
  readonly filePath: string | null;
  readonly diffContent: string | null;
  readonly explanation: string;
  /** Populated in later phases only; Engineer leaves it null. */
  readonly validatedAt?: string | null;
}

export interface EngineerPatchRecord {
  readonly id: string;
  readonly vulnerabilityId: string;
  readonly status: EngineerPatchStatus;
  readonly filePath: string | null;
  readonly diffContent: string | null;
  readonly explanation: string;
  readonly createdAt: string;
}

export interface EngineerPatchRepository {
  /** Persist a generated/rejected patch (never applies anything). */
  saveGeneratedPatch(input: SaveEngineerPatchInput): Promise<EngineerPatchRecord>;
  getById(id: string): Promise<EngineerPatchRecord | null>;
  /** Most recent patch for a vulnerability (or null). */
  getByVulnerabilityId(vulnerabilityId: string): Promise<EngineerPatchRecord | null>;
}