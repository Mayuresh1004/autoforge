import type { AttackPlan, PlannedTarget } from '../models/plan';
import type { ProfileInput, StaticVulnInput, SurfaceInput } from '../models/plan-input';

export interface PlannedPlanPayload {
  readonly scanId: string;
  readonly plan: {
    readonly coveredSurfaces: number;
    readonly coveredFindings: number;
    readonly summary: AttackPlan['summary'];
    readonly targets: readonly PlannedTarget[];
  };
}

/** Persistence port for Attack Plans. Reads the raw reasoning inputs and
 * stores the resulting plan. The Planner never executes attacks. */
export interface PlanRepository {
  /** Whether the source static-scan exists. */
  scanExists(scanId: string): Promise<boolean>;
  /** Static findings attached to a scan (empty when none stored). */
  loadStaticFindings(scanId: string): Promise<readonly StaticVulnInput[]>;
  /** Latest completed Scout surface for a scan (empty when none). */
  loadAttackSurface(scanId: string): Promise<readonly SurfaceInput[]>;
  /** Repository profile signals (language / stack / tech). */
  loadProfile(scanId: string): Promise<ProfileInput>;
  /** Persist a generated plan + its targets; returns the stored plan. */
  savePlan(payload: PlannedPlanPayload): Promise<AttackPlan>;
  getPlan(planId: string): Promise<AttackPlan | null>;
  getPlanForScan(scanId: string): Promise<AttackPlan | null>;
}