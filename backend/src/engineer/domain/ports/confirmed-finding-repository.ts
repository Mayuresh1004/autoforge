/**
 * Confirmed-finding source for the Engineer — the projection of an
 * EXECUTION record + the correlating Vulnerability row the Engineer needs to
 * build its prompt:
 *
 *   Exploit (status CONFIRMED, type SQL_INJECTION, PoC metadata)
 *     → vulnerabilityId → Vulnerability (filePath, lineNumber, severity, cwe)
 *
 * The engine never reads Docker or the attack-plan tables: it consumes this
 * narrow port, implemented over the existing Prisma schema (no new models).
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
}

export interface ConfirmedFindingRepository {
  /** All CONFIRMED SQL_INJECTION exploits for a scan, newest first. */
  listConfirmed(scanId: string): Promise<readonly ConfirmedVulnerabilityFinding[]>;
  /** A single confirmed finding by id, or null. */
  findByVulnerabilityId(
    scanId: string,
    vulnerabilityId: string,
  ): Promise<ConfirmedVulnerabilityFinding | null>;
}