import type { Severity } from '../../../domain/models/severity';

/**
 * Maps scanner-specific severity strings onto the canonical ladder.
 * Unknown values never make a security decision; they fall back to `INFO`
 * (and are logged by the caller).
 */
const ALIASES: Record<string, Severity> = {
  critical: 'CRITICAL',
  urgent: 'CRITICAL',
  blocking: 'CRITICAL',
  high: 'HIGH',
  important: 'HIGH',
  error: 'HIGH',
  medium: 'MEDIUM',
  moderate: 'MEDIUM',
  warning: 'MEDIUM',
  low: 'LOW',
  normal: 'LOW',
  info: 'INFO',
  informational: 'INFO',
  none: 'INFO',
  undefined: 'INFO',
  undef: 'INFO',
  unknown: 'INFO',
};

export function mapSeverity(toolSeverity: string): Severity {
  const key = (toolSeverity ?? '').trim().toLowerCase();
  return ALIASES[key] ?? 'INFO';
}