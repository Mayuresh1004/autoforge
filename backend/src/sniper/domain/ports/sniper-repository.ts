import type {
  AttemptRecord,
  ConfidenceBreakdown,
  CorrelatedFinding,
  EvidenceItem,
  ProofOfConcept,
  VerificationStatus,
} from '../models/verification';
import type { VulnerabilityType } from '../models/vulnerability-type';

/** Snapshot of one planned target as persisted by the Attack Planner. */
export interface PlannedTargetSnapshot {
  /** Row id (planned_attack_targets.id). */
  readonly id: string;
  /** Planner-synthesized target id (planned_attack_targets.targetId). */
  readonly targetId: string;
  readonly scanId: string;
  readonly endpoint: string;
  readonly method: string;
  readonly candidateVulnerabilities: readonly string[];
  readonly priority: number;
  readonly recommendedTool: string;
  readonly reason: string;
  readonly requiresAuthentication: boolean;
  readonly estimatedRisk: string;
}

/** Payload to persist (or update) the final exploit record for a target. */
export interface SaveExploitPayload {
  readonly scanId: string;
  readonly targetId: string;
  readonly vulnerabilityId?: string | null;
  readonly type: VulnerabilityType;
  readonly status: VerificationStatus;
  readonly confidence: number | null;
  readonly confidenceBreakdown: ConfidenceBreakdown | null;
  readonly endpoint: string;
  readonly method: string;
  readonly parameter: string | null;
  readonly tool: string | null;
  readonly reason: string;
  readonly evidence: readonly EvidenceItem[];
  readonly attacks: number;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly durationMs: number | null;
  readonly errorMessage?: string | null;
}

/** Payload for one persisted verification attempt. */
export interface SaveAttemptPayload {
  readonly exploitId: string;
  readonly attemptNumber: number;
  readonly verifier: string;
  readonly tool: string | null;
  readonly status: VerificationStatus;
  readonly stdout: string | null;
  readonly stderr: string | null;
  readonly errorMessage: string | null;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly retried: boolean;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly durationMs: number | null;
}

/** Persistence port for Sniper outputs. */
export interface SniperRepository {
  /** The planned target this targetId maps to (or null). */
  loadPlannedTarget(targetId: string): Promise<PlannedTargetSnapshot | null>;
  /** Static findings for confidence correlation (type + confidence only). */
  loadFindings(scanId: string): Promise<readonly CorrelatedFinding[]>;
  /** Create or update the final exploit record; returns the stored row. */
  saveExploit(payload: SaveExploitPayload): Promise<ProofOfConcept>;
  /** The stored final record for (targetId, type), if any. */
  getExploitForTarget(targetId: string, type: VulnerabilityType): Promise<ProofOfConcept | null>;
  getExploit(id: string): Promise<ProofOfConcept | null>;
  listExploitsByTarget(targetId: string): Promise<readonly ProofOfConcept[]>;
  /** All attempts for an exploit (oldest first). */
  listAttempts(exploitId: string): Promise<readonly AttemptRecord[]>;
  saveAttempt(payload: SaveAttemptPayload): Promise<void>;
}