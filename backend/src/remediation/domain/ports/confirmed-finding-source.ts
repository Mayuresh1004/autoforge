/**
 * Confirmed-finding source port — the single abstraction both the Engineer
 * and the Critic use to resolve CONFIRMED SQL_INJECTION exploits. One
 * implementation (Prisma) backs both agents; agent layers never query the
 * DB themselves.
 */

import type { ConfirmedFindingPayload } from '../models/confirmed-finding';

export const REMEDIATION_SUPPORTED_TYPE = 'SQL_INJECTION';
export const REMEDIATION_CONFIRMED_STATUS = 'CONFIRMED';

export interface ConfirmedFindingSource {
  /** All CONFIRMED SQL_INJECTION exploits for a scan, newest first. */
  listConfirmed(scanId: string): Promise<readonly ConfirmedFindingPayload[]>;
  /**
   * The single confirmed finding for a vulnerability (optionally scoped to a
   * scan), newest first — or null when no CONFIRMED SQL_INJECTION exploit
   * exists for it. `scanId` is required by the Engineer (scan-scoped),
   * omitted by the Critic (patch-scoped).
   */
  findByVulnerabilityId(input: {
    readonly scanId?: string;
    readonly vulnerabilityId: string;
  }): Promise<ConfirmedFindingPayload | null>;
}