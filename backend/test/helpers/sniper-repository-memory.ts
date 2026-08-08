import type {
  AttemptRecord,
  CorrelatedFinding,
  EvidenceItem,
  ProofOfConcept,
} from '../../src/sniper/domain/models/verification';
import type {
  PlannedTargetSnapshot,
  SaveAttemptPayload,
  SaveExploitPayload,
  SniperRepository,
} from '../../src/sniper/domain/ports/sniper-repository';
import type { VulnerabilityType } from '../../src/sniper/domain/models/vulnerability-type';

/** In-memory SniperRepository mirroring the Prisma shape — headless tests. */
export class MemorySniperRepository implements SniperRepository {
  private targets = new Map<string, PlannedTargetSnapshot>();
  private findings = new Map<string, CorrelatedFinding[]>();
  private exploits = new Map<string, ProofOfConcept>();
  private byTargetType = new Map<string, string>(); // `${targetId}|${type}` -> exploitId
  private attempts = new Map<string, AttemptRecord[]>(); // exploitId -> attempts
  private attemptSeq = 0;

  seedTarget(target: PlannedTargetSnapshot): void {
    this.targets.set(target.targetId, target);
  }

  seedFindings(scanId: string, findings: CorrelatedFinding[]): void {
    this.findings.set(scanId, findings);
  }

  seedExploit(exploit: ProofOfConcept): void {
    this.exploits.set(exploit.id, exploit);
    this.byTargetType.set(`${exploit.targetId}|${exploit.type}`, exploit.id);
  }

  get allExploits(): ProofOfConcept[] {
    return [...this.exploits.values()];
  }

  get allAttempts(): AttemptRecord[] {
    return [...this.attempts.values()].flat();
  }

  async loadPlannedTarget(targetId: string): Promise<PlannedTargetSnapshot | null> {
    return this.targets.get(targetId) ?? null;
  }

  async loadFindings(scanId: string): Promise<CorrelatedFinding[]> {
    return this.findings.get(scanId) ?? [];
  }

  async saveExploit(payload: SaveExploitPayload): Promise<ProofOfConcept> {
    const key = `${payload.targetId}|${payload.type}`;
    const existingId = this.byTargetType.get(key);
    const id = existingId ?? `exploit_${this.exploits.size + 1}`;

    const poc: ProofOfConcept = {
      id,
      targetId: payload.targetId,
      scanId: payload.scanId,
      vulnerabilityId: payload.vulnerabilityId ?? null,
      type: payload.type,
      status: payload.status,
      confidence: payload.confidence,
      confidenceBreakdown: payload.confidenceBreakdown,
      endpoint: payload.endpoint,
      method: payload.method,
      parameter: payload.parameter,
      verifier: payload.tool ?? '',
      tool: payload.tool,
      reason: payload.reason,
      evidence: payload.evidence,
      attacks: payload.attacks,
      startedAt: payload.startedAt.toISOString(),
      completedAt: payload.completedAt.toISOString(),
      durationMs: payload.durationMs,
    };
    this.exploits.set(id, poc);
    this.byTargetType.set(key, id);
    return poc;
  }

  async getExploitForTarget(targetId: string, type: VulnerabilityType): Promise<ProofOfConcept | null> {
    const id = this.byTargetType.get(`${targetId}|${type}`);
    return id ? (this.exploits.get(id) ?? null) : null;
  }

  async getExploit(id: string): Promise<ProofOfConcept | null> {
    return this.exploits.get(id) ?? null;
  }

  async listExploitsByTarget(targetId: string): Promise<ProofOfConcept[]> {
    return [...this.exploits.values()]
      .filter((e) => e.targetId === targetId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async listAttempts(exploitId: string): Promise<AttemptRecord[]> {
    return this.attempts.get(exploitId) ?? [];
  }

  async saveAttempt(payload: SaveAttemptPayload): Promise<void> {
    const list = this.attempts.get(payload.exploitId) ?? [];
    list.push({
      id: `attempt_${++this.attemptSeq}`,
      exploitId: payload.exploitId,
      attemptNumber: payload.attemptNumber,
      verifier: payload.verifier,
      tool: payload.tool,
      status: payload.status,
      stdout: payload.stdout,
      stderr: payload.stderr,
      errorMessage: payload.errorMessage,
      exitCode: payload.exitCode,
      timedOut: payload.timedOut,
      retried: payload.retried,
      startedAt: payload.startedAt?.toISOString() ?? null,
      completedAt: payload.completedAt?.toISOString() ?? null,
      durationMs: payload.durationMs,
    });
    this.attempts.set(payload.exploitId, list);
  }
}

export function makeEvidence(indicator: string, category: string, factor: number): EvidenceItem {
  return { indicator, category: category as EvidenceItem['category'], confidenceFactor: factor };
}