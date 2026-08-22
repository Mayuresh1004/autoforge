/**
 * Canonical confirmed-vulnerability finding — the SHARED projection used by
 * BOTH the Engineer (to build a patch) and the Critic (to re-verify the same
 * exploit target) so both agents always resolve the SAME finding semantics
 * (one query, one mapping, one redaction policy).
 *
 * Model derivation:
 *
 *   Exploit (status CONFIRMED, type SQL_INJECTION, PoC metadata)
 *     → vulnerabilityId → Vulnerability (filePath, lineNumber, severity, cwe)
 *
 * No module reads Docker or the attack-plan tables: everyone consumes this
 * narrow projection, implemented once over the existing Prisma schema.
 */

import type { AgentFindingSeverity } from '../../../agent/domain/models/agent-scan-context';
import type { VulnerabilityType } from '../../../sniper/domain/models/vulnerability-type';

export interface ConfirmedVulnerabilityFinding {
  /** Vulnerability row id (foreign key of the engineered patch). */
  readonly vulnerabilityId: string;
  readonly scanId: string;
  /** PoC (Exploit row) id that confirmed this finding. */
  readonly exploitId: string;
  readonly type: VulnerabilityType;
  readonly status: 'CONFIRMED';
  readonly severity: AgentFindingSeverity;
  readonly confidence: number;
  readonly cwe: string | null;
  readonly cve: string | null;
  readonly title: string | null;
  readonly message: string | null;
  readonly filePath: string | null;
  readonly lineNumber: number | null;
  readonly endpoint: string | null;
  readonly method: string | null;
  readonly parameter: string | null;
  /** Redacted, truncated evidence summary from the verifier. */
  readonly evidence: string | null;
  readonly reason: string | null;
  /** Number of verification attempts (depth signal for selection). */
  readonly exploitDepth: number;
  readonly confirmedAt: string;
  /** Planned-target id Sniper used when it confirmed this exploit (optional). */
  readonly exploitTargetId?: string;
}

/**
 * The payload the Critic needs in ADDITION to the finding: the sync target
 * id the original Sniper confirmation attacked (the Critic re-runs the SAME
 * target) plus the Vulnerability row's own status (the Critic demands the
 * vulnerability itself be CONFIRMED before validating anything).
 */
export interface ConfirmedFindingPayload extends ConfirmedVulnerabilityFinding {
  /** Planned-target id Sniper used when it confirmed this exploit. */
  readonly exploitTargetId: string;
  /** Vulnerability.status of the correlated row (for extra criticality). */
  readonly vulnerabilityStatus: string | null;
}