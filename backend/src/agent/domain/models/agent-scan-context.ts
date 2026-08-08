/**
 * AgentScanContext — the agent-facing context model, SEPARATE from the
 * static scanner's internal ScanContext. It is the read-only snapshot an
 * agent (Engineer, future Critic) receives: everything about the scan is an
 * OPTIONAL field (no Docker internals, no providers, no prompt content).
 *
 * Optional-by-design: a passive agent can run on a scan that has only a
 * repository, only findings, only an attack plan, or all of it.
 */

import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';
import type { RepositoryProfile } from '../../../repository-analysis/domain/models/repository-profile';
import type { AttackPlan } from '../../../planner/domain/models/plan';

export type AgentFindingSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Compact finding — what an agent needs, not the scanner's raw output. */
export interface AgentFinding {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly severity: AgentFindingSeverity | string;
  readonly ruleId: string | null;
  readonly filePath: string | null;
  readonly cveId: string | null;
}

export interface AgentExploitOutcome {
  readonly targetId: string;
  readonly vulnerabilityType: string;
  readonly status: string;
  readonly confidence: number | null;
}

/** read-only, all optional except scanId. */
export interface AgentScanContext {
  readonly scanId: string;
  readonly repository?: AttackRef;
  readonly repositoryProfile?: RepositoryProfile;
  readonly runtimeContext?: RuntimeSandboxContext;
  readonly staticFindings?: ReadonlyArray<AgentFinding>;
  readonly staticFindingSummary?: {
    readonly total: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
  };
  readonly attackSurface?: ReadonlyArray<AttackSurfaceEntry>;
  readonly attackPlan?: AttackPlan;
  readonly verifiedExploits?: ReadonlyArray<AgentExploitOutcome>;
  readonly createdAt: string;
}

/** Everything below is a thin projection; each field stays optional and
 *  never carries raw scanner internals. */
export interface AttackRef {
  readonly name?: string;
  readonly url?: string;
  readonly path?: string;
}

export interface AttackSurfaceEntry {
  readonly id: string;
  readonly url: string;
  readonly method?: string;
}

/**
 * Build a usable minimal context with strict validation of scanId — the only
 * required field. Provided so tests and adapters construct contexts the same
 * way (no free-form object literals leaking across modules).
 */
export interface AgentScanContextFactory {
  build(input: Partial<Omit<AgentScanContext, 'scanId'>> & { scanId: string }): AgentScanContext;
}

export function createAgentScanContext(
  input: Partial<Omit<AgentScanContext, 'scanId'>> & { scanId: string },
): AgentScanContext {
  if (typeof input.scanId !== 'string' || input.scanId.trim().length === 0) {
    throw new TypeError('AgentScanContext requires a non-empty scanId');
  }
  return {
    scanId: input.scanId,
    repository: input.repository,
    repositoryProfile: input.repositoryProfile,
    runtimeContext: input.runtimeContext,
    staticFindings: input.staticFindings,
    staticFindingSummary: input.staticFindingSummary,
    attackSurface: input.attackSurface,
    attackPlan: input.attackPlan,
    verifiedExploits: input.verifiedExploits,
    createdAt:
      input.createdAt ?? new Date().toISOString(),
  };
}