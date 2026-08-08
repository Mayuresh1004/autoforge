import type {
  AttackSurfaceEntry,
  DetectedTechnology,
  DiscoveredService,
  OpenPort,
} from '../../src/scout/domain/models/attack-surface';
import type {
  PersistScoutRun,
  ScoutContext,
  ScoutQueryResult,
  ScoutRepository,
} from '../../src/scout/domain/ports/scout-repository';
import type { ScoutScanRecord, ScoutSummary } from '../../src/scout/domain/models/scout-scan';

interface Row {
  record: ScoutScanRecord;
  attackSurface: AttackSurfaceEntry[];
  technologies: DetectedTechnology[];
  ports: OpenPort[];
  services: DiscoveredService[];
}

/** In-memory ScoutRepository for deterministic, headless recon tests. */
export class MemoryScoutRepository implements ScoutRepository {
  private readonly rows = new Map<string, Row>();
  private readonly contexts = new Map<string, ScoutContext>();
  private next = 1;

  setContext(context: ScoutContext): void {
    this.contexts.set(context.scanId, context);
  }

  getScanCount(): number {
    return this.rows.size;
  }

  async getContext(scanId: string): Promise<ScoutContext | null> {
    return this.contexts.get(scanId) ?? null;
  }

  async createScoutScan(input: { scanId: string; targetUrl: string }): Promise<ScoutScanRecord> {
    const id = `scout-${this.next++}`;
    const now = new Date();
    const record: ScoutScanRecord = {
      id,
      scanId: input.scanId,
      targetUrl: input.targetUrl,
      status: 'PENDING',
      startedAt: now,
      completedAt: null,
      summary: null,
      createdAt: now,
    };
    this.rows.set(id, {
      record,
      attackSurface: [],
      technologies: [],
      ports: [],
      services: [],
    });
    return record;
  }

  async markRunning(scoutScanId: string, startedAt: Date): Promise<void> {
    const row = this.rows.get(scoutScanId);
    if (row) row.record = { ...row.record, status: 'RUNNING', startedAt };
  }

  async completeScoutScan(
    scoutScanId: string,
    status: 'COMPLETED' | 'FAILED',
    summary: ScoutSummary,
    completedAt: Date,
  ): Promise<void> {
    const row = this.rows.get(scoutScanId);
    if (row) row.record = { ...row.record, status, summary, completedAt };
  }

  async persist(scoutScanId: string, run: PersistScoutRun): Promise<void> {
    const row = this.rows.get(scoutScanId);
    if (!row) return;
    row.attackSurface.push(...run.attackSurface);
    row.technologies.push(...run.technologies);
    row.ports.push(...run.ports);
    row.services.push(...run.services);
  }

  async getScoutScan(scoutScanId: string): Promise<ScoutQueryResult | null> {
    const row = this.rows.get(scoutScanId);
    if (!row) return null;
    return {
      scoutScan: row.record,
      attackSurface: row.attackSurface,
      technologies: row.technologies,
      ports: row.ports,
      services: row.services,
    };
  }

  async listScoutScans(scanId: string): Promise<ScoutScanRecord[]> {
    return [...this.rows.values()].map((r) => r.record).filter((r) => r.scanId === scanId);
  }
}