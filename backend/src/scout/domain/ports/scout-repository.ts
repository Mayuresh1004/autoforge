import type {
  AttackSurfaceEntry,
  DetectedTechnology,
  DiscoveredService,
  OpenPort,
} from '../models/attack-surface';
import type { ScoutScanRecord, ScoutSummary } from '../models/scout-scan';

/** The source scan context the Scout run is attached to. */
export interface ScoutContext {
  readonly scanId: string;
  readonly scanStatus: string;
  readonly repositoryName: string | null;
  readonly repositoryUrl: string | null;
  readonly staticFindings: number;
}

export interface PersistScoutRun {
  readonly attackSurface: readonly AttackSurfaceEntry[];
  readonly technologies: readonly DetectedTechnology[];
  readonly ports: readonly OpenPort[];
  readonly services: readonly DiscoveredService[];
}

export interface ScoutQueryResult {
  readonly scoutScan: ScoutScanRecord;
  readonly attackSurface: readonly AttackSurfaceEntry[];
  readonly technologies: readonly DetectedTechnology[];
  readonly ports: readonly OpenPort[];
  readonly services: readonly DiscoveredService[];
}

/** Persistence port for Scout recon runs. Implemented by the Prisma adapter
 * in production and by an in-memory adapter in tests. */
export interface ScoutRepository {
  /** Resolve the source static-scan context (null when scanId is unknown). */
  getContext(scanId: string): Promise<ScoutContext | null>;
  createScoutScan(input: { readonly scanId: string; readonly targetUrl: string }): Promise<ScoutScanRecord>;
  markRunning(scoutScanId: string, startedAt: Date): Promise<void>;
  completeScoutScan(
    scoutScanId: string,
    status: 'COMPLETED' | 'FAILED',
    summary: ScoutSummary,
    completedAt: Date,
  ): Promise<void>;
  persist(scoutScanId: string, run: PersistScoutRun): Promise<void>;
  getScoutScan(scoutScanId: string): Promise<ScoutQueryResult | null>;
  listScoutScans(scanId: string): Promise<readonly ScoutScanRecord[]>;
}