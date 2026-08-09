/**
 * Confirmed-finding source for the Engineer — the projection of a
 * CONFIRMED SQL Injection exploit + the correlating Vulnerability row the
 * Engineer needs to build its prompt. The canonical finding TYPE now lives
 * in the shared remediation module (where the Critic reads the same
 * projection); this port is what keeps the Engineer's selection/prompting
 * decoupled from the query responsible for finding rows.
 */

export type { ConfirmedVulnerabilityFinding } from '../../../remediation/domain/models/confirmed-finding';
import type { ConfirmedVulnerabilityFinding } from '../../../remediation/domain/models/confirmed-finding';

export interface ConfirmedFindingRepository {
  /** All CONFIRMED SQL_INJECTION exploits for a scan, newest first. */
  listConfirmed(scanId: string): Promise<readonly ConfirmedVulnerabilityFinding[]>;
  /** A single confirmed finding by id, or null. */
  findByVulnerabilityId(
    scanId: string,
    vulnerabilityId: string,
  ): Promise<ConfirmedVulnerabilityFinding | null>;
}