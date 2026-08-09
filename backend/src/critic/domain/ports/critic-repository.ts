/**
 * Critic persistence port — one row per validation run; attempts are never
 * overwritten (each run's result is its own row). Implemented on the new
 * minimal `CriticRun` Prisma model (no duplication of Patch/Vulnerability).
 */

import type { CriticFailureKind, CriticRunResult } from '../models/critic-result';

export interface SaveCriticRunInput {
  readonly patchId: string;
  readonly vulnerabilityId: string;
  readonly scanId: string;
  readonly executionId: string | null;
  readonly attempt: number;
  readonly status: 'APPROVED' | 'REJECTED' | 'FAILED';
  readonly failureKind: CriticFailureKind | null;
  readonly checks: unknown;
  readonly exploit: unknown;
  readonly feedback: unknown;
  readonly errorMessage?: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface CriticRepository {
  save(input: SaveCriticRunInput): Promise<CriticRunResult>;
  getById(id: string): Promise<CriticRunResult | null>;
  /** All runs for a patch, oldest first (attempt order). */
  listByPatch(patchId: string): Promise<readonly CriticRunResult[]>;
  /** The run recorded against one AgentExecution id. */
  getByExecutionId(executionId: string): Promise<CriticRunResult | null>;
}