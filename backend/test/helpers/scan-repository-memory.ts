import type { ScanRepository } from '../../src/static-scanner/domain/ports/scan-repository';
import type {
  CompleteScanInput,
  CreateScanInput,
} from '../../src/static-scanner/domain/ports/scan-repository';
import type {
  ScanStatus,
  ScannerStatistics,
  StoredFinding,
  StoredRepository,
  StoredScan,
} from '../../src/static-scanner/domain/models/scan';
import type { UnifiedFinding } from '../../src/static-scanner/domain/models/finding';

interface MemoryRow {
  scan: {
    id: string;
    name: string;
    status: ScanStatus;
    startedAt: Date;
    completedAt: Date | null;
    createdAt: Date;
    scannerStats: ScannerStatistics[];
  };
  repository: StoredRepository | null;
  findings: StoredFinding[];
}

/**
 * In-memory ScanRepository for tests. Mirrors the port contract without a
 * database, so integration tests are deterministic and headless.
 */
export class MemoryScanRepository implements ScanRepository {
  private readonly rows = new Map<string, MemoryRow>();
  private readonly repositories = new Map<string, StoredRepository>();
  private nextId = 1;

  /** Test-only: number of scans stored. */
  getScanCount(): number {
    return this.rows.size;
  }

  private uid(prefix: string): string {
    return `${prefix}_${this.nextId++}`;
  }

  async upsertRepository(input: {
    url: string;
    name: string;
    branch: string;
  }): Promise<StoredRepository> {
    const key = `${input.url}|${input.branch}`;
    const existing = this.repositories.get(key);
    if (existing) return existing;
    const repository: StoredRepository = {
      id: this.uid('repo'),
      name: input.name,
      url: input.url,
      branch: input.branch,
    };
    this.repositories.set(key, repository);
    return repository;
  }

  async createScan(input: CreateScanInput): Promise<StoredScan> {
    const now = new Date();
    const row: MemoryRow = {
      scan: {
        id: this.uid('scan'),
        name: input.name,
        status: 'PENDING',
        startedAt: now,
        completedAt: null,
        createdAt: now,
        scannerStats: [],
      },
      repository: null,
      findings: [],
    };
    this.rows.set(row.scan.id, row);
    return toStoredScan(row);
  }

  async linkScanRepository(scanId: string, repositoryId: string): Promise<void> {
    const row = this.rows.get(scanId);
    if (!row) throw new Error(`scan not found: ${scanId}`);
    row.repository = this.findRepositoryById(repositoryId) ?? null;
  }

  async markScanRunning(scanId: string, startedAt: Date): Promise<void> {
    const row = this.rows.get(scanId);
    if (!row) throw new Error(`scan not found: ${scanId}`);
    row.scan.status = 'RUNNING';
    row.scan.startedAt = startedAt;
  }

  async completeScan(scanId: string, input: CompleteScanInput): Promise<void> {
    const row = this.rows.get(scanId);
    if (!row) throw new Error(`scan not found: ${scanId}`);
    row.scan.status = input.status;
    row.scan.completedAt = input.completedAt;
    row.scan.scannerStats = [...input.scannerStats];
  }

  async saveFindings(scanId: string, findings: readonly UnifiedFinding[]): Promise<number> {
    const row = this.rows.get(scanId);
    if (!row) throw new Error(`scan not found: ${scanId}`);
    const createdAt = new Date();
    row.findings = findings.map((finding) => ({
      id: finding.id,
      scanId,
      scanner: finding.scanner,
      type: finding.type,
      severity: finding.severity,
      confidence: finding.confidence,
      file: finding.file,
      line: finding.line,
      message: finding.message,
      cwe: finding.cwe,
      cve: finding.cve,
      references: [...finding.references],
      evidence: finding.evidence,
      createdAt,
    }));
    return row.findings.length;
  }

  async getScan(scanId: string): Promise<StoredScan | null> {
    const row = this.rows.get(scanId);
    return row ? toStoredScan(row) : null;
  }

  async getScanResults(
    scanId: string
  ): Promise<{ scan: StoredScan; findings: readonly StoredFinding[] } | null> {
    const row = this.rows.get(scanId);
    if (!row) return null;
    return { scan: toStoredScan(row), findings: [...row.findings] };
  }

  private findRepositoryById(id: string): StoredRepository | undefined {
    return [...this.repositories.values()].find((repository) => repository.id === id);
  }
}

function toStoredScan(row: MemoryRow): StoredScan {
  return {
    id: row.scan.id,
    name: row.scan.name,
    status: row.scan.status,
    startedAt: row.scan.startedAt,
    completedAt: row.scan.completedAt,
    createdAt: row.scan.createdAt,
    scannerStats: [...row.scan.scannerStats],
    repository: row.repository,
  };
}