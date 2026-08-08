import type { AttackPlan } from '../models/plan';
import type { PlanRequest } from '../models/plan-input';

/**
 * Agent-facing planning port. This is a *reasoning* service: it returns a
 * prioritized Attack Plan and never runs/imitates an attack.
 */
export interface PlannerService {
  /** Load inputs for a scan, reason → persist → return the plan. */
  generate(scanId: string): Promise<AttackPlan>;
  /** Pure planning over provided inputs (used directly and in tests). */
  plan(request: PlanRequest): Promise<AttackPlan>;
  getPlan(planId: string): Promise<AttackPlan>;
  getPlanForScan(scanId: string): Promise<AttackPlan | null>;
}