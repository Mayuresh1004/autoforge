import type { AttackSurfaceReport } from '../models/scout-report';
import type { ScoutScanRecord } from '../models/scout-scan';
import type { ScoutQueryResult } from './scout-repository';

export interface RunScoutOptions {
  readonly timeoutMs?: number;
  readonly maxPages?: number;
  readonly maxDepth?: number;
  readonly probeCommonPaths?: boolean;
  readonly portScan?: boolean;
}

export interface RunScoutInput {
  /** The source static-scan id (must exist). */
  readonly scanId: string;
  /** The running application URL (inside the sandbox). */
  readonly targetUrl: string;
  readonly options?: RunScoutOptions;
}

/** Agent-facing Scout service. Recon only: discovers, never exploits. */
export interface ScoutService {
  run(input: RunScoutInput): Promise<AttackSurfaceReport>;
  getScoutScan(scoutScanId: string): Promise<ScoutQueryResult | null>;
  listScoutScans(scanId: string): Promise<readonly ScoutScanRecord[]>;
}