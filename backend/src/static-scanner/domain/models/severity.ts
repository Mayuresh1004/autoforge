/**
 * Canonical severity ladder used across the whole scanner module.
 * Scanner-specific values are mapped into this set — never exposed raw.
 */

export const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type Severity = (typeof SEVERITIES)[number];

const RANKS: Record<Severity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export function severityRank(severity: Severity): number {
  return RANKS[severity];
}

/** True when `severity` is at least as severe as `threshold`. */
export function isAtOrAbove(severity: Severity, threshold: Severity): boolean {
  return severityRank(severity) >= severityRank(threshold);
}
