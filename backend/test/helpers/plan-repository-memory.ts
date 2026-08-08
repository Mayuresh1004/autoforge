import type { AttackPlan } from '../../src/planner/domain/models/plan';
import type { ProfileInput, StaticVulnInput, SurfaceInput } from '../../src/planner/domain/models/plan-input';
import type { PlanRepository, PlannedPlanPayload } from '../../src/planner/domain/ports/plan-repository';
import { newPlanId, summarizeTargets } from '../../src/planner/application/ranking/plan-engine';

/** In-memory PlanRepository for headless tests — mirrors the Prisma shape. */
export class MemoryPlanRepository implements PlanRepository {
  private scans = new Set<string>();
  private findings = new Map<string, StaticVulnInput[]>();
  private surfaces = new Map<string, SurfaceInput[]>();
  private profiles = new Map<string, ProfileInput>();
  private plans = new Map<string, AttackPlan>();
  private byScan = new Map<string, string>();

  seedScan(scanId: string, opts?: { notExists?: boolean }): void {
    this.scans.add(scanId);
    if (!opts?.notExists) {
      this.findings.set(scanId, this.findings.get(scanId) ?? []);
      this.surfaces.set(scanId, this.surfaces.get(scanId) ?? []);
    }
  }

  seedFindings(scanId: string, findings: StaticVulnInput[]): void {
    this.findings.set(scanId, findings);
  }

  seedSurfaces(scanId: string, surfaces: SurfaceInput[]): void {
    this.surfaces.set(scanId, surfaces);
  }

  seedProfile(scanId: string, profile: ProfileInput): void {
    this.profiles.set(scanId, profile);
  }

  async scanExists(scanId: string): Promise<boolean> {
    return this.scans.has(scanId);
  }

  async loadStaticFindings(scanId: string): Promise<StaticVulnInput[]> {
    return this.findings.get(scanId) ?? [];
  }

  async loadAttackSurface(scanId: string): Promise<SurfaceInput[]> {
    return this.surfaces.get(scanId) ?? [];
  }

  async loadProfile(scanId: string): Promise<ProfileInput> {
    return this.profiles.get(scanId) ?? { language: null, framework: null, technologies: [] };
  }

  async savePlan(payload: PlannedPlanPayload): Promise<AttackPlan> {
    const id = newPlanId();
    const targets = payload.plan.targets;
    targets.sort((a, b) => b.priority - a.priority);
    const plan: AttackPlan = {
      id,
      scanId: payload.scanId,
      createdAt: new Date().toISOString(),
      coveredSurfaces: payload.plan.coveredSurfaces,
      coveredFindings: payload.plan.coveredFindings,
      summary: summarizeTargets(targets),
      targets,
    };
    this.plans.set(id, plan);
    this.byScan.set(payload.scanId, id);
    return plan;
  }

  async getPlan(planId: string): Promise<AttackPlan | null> {
    return this.plans.get(planId) ?? null;
  }

  async getPlanForScan(scanId: string): Promise<AttackPlan | null> {
    const id = this.byScan.get(scanId);
    if (!id) return null;
    return this.plans.get(id) ?? null;
  }
}