import type {
  AttackSurfaceEntry,
  DetectedTechnology,
  DiscoveredService,
  OpenPort,
} from './attack-surface';
import type { ScoutSummary } from './scout-scan';

export interface ScoutHealth {
  readonly reachable: boolean;
  readonly statusCode: number | null;
  readonly latencyMs: number | null;
  readonly error: string | null;
}

/** The complete Attack Surface Report produced by a Scout run. */
export interface AttackSurfaceReport {
  /** The source static-scan this recon was attached to. */
  readonly scanId: string;
  /** The id of the persisted ScoutScan record for this run. */
  readonly scoutScanId: string;
  readonly targetUrl: string;
  readonly status: 'COMPLETED' | 'FAILED';
  readonly health: ScoutHealth;
  readonly summary: ScoutSummary;
  readonly attackSurface: readonly AttackSurfaceEntry[];
  readonly technologies: readonly DetectedTechnology[];
  readonly ports: readonly OpenPort[];
  readonly services: readonly DiscoveredService[];
  /** Non-fatal tool/probe failures (recon continues past these). */
  readonly errors: readonly string[];
}