/**
 * Critic finding resolver — turns a generated patch into the exact
 * CONFIRMED SQL_INJECTION exploit it claims to fix. Reuses the Sniper's
 * planned-target identity so retests hammer the SAME target the original
 * verification used (no invented exploit targets).
 */

import type { ConfirmedVulnerabilityFinding } from '../../../remediation/domain/models/confirmed-finding';

export interface CriticPatchContext {
  /** Engineer's confirmed-finding projection (status CONFIRMED, type SQL_INJECTION). */
  readonly finding: ConfirmedVulnerabilityFinding;
  /** The planned-target id Sniper confirmed against — retest uses the same id. */
  readonly exploitTargetId: string;
  /** Endpoint/method for human review (must match Sniper's record). */
  readonly endpoint: string;
  readonly method: string;
}

export interface CriticFindingResolver {
  /** Resolve the patch + its confirmed finding, or null when unreviewable. */
  resolveForPatch(patchId: string): Promise<CriticPatchContext | null>;
}