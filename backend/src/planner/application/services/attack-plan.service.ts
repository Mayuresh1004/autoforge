import { logger } from '../../../config/logger';
import type { AttackPlan } from '../../domain/models/plan';
import type { PlanRequest } from '../../domain/models/plan-input';
import type { PlannerService } from '../../domain/ports/planner';
import type { PlanRepository } from '../../domain/ports/plan-repository';
import { ScanNotFoundError, PlanNotFoundError } from '../../domain/errors/planner.errors';
import type { AmassEventPublisher, AmassEventInput } from '../../../observability/domain/ports/event-bus';
import { PlanEngine, newPlanId } from '../ranking/plan-engine';

export interface PlannerDeps {
  readonly repository: PlanRepository;
  readonly engine: PlanEngine;
  /** Phase 9 observability publisher (default: silent). */
  readonly events?: AmassEventPublisher;
}

/**
 * Attack Planner service. It *reasons only*: loads the repository profile,
 * static findings and attack-surface report for a scan, ranks targets by
 * preliminary priority, and persists the plan. It never attacks, scans,
 * exploits or patches anything.
 */
export class AttackPlanService implements PlannerService {
  constructor(private readonly deps: PlannerDeps) {}

  async generate(scanId: string): Promise<AttackPlan> {
    if (!(await this.deps.repository.scanExists(scanId))) {
      throw new ScanNotFoundError(scanId);
    }
    const findings = await this.deps.repository.loadStaticFindings(scanId);
    const surface = await this.deps.repository.loadAttackSurface(scanId);
    const profile = await this.deps.repository.loadProfile(scanId);

    this.emit(scanId, {
      eventType: 'PLANNER_STARTED',
      agentType: 'PLANNER',
      phase: 'planning',
      status: 'STARTED',
      message: 'building the attack plan',
      metadata: { counts: { findings: findings.length, surfaces: surface.length } },
    });
    const plan = await this.plan({
      scanId,
      staticFindings: findings,
      attackSurface: surface,
      profile,
    });
    const saved = await this.deps.repository.savePlan({ scanId, plan: stripPlanIds(plan) });
    this.emit(scanId, {
      eventType: 'PLANNER_COMPLETED',
      agentType: 'PLANNER',
      phase: 'planning',
      status: 'COMPLETED',
      message: `attack plan ${saved.id} ready (${saved.targets.length} targets)`,
      metadata: { counts: { targets: saved.targets.length, coveredSurfaces: saved.coveredSurfaces } },
    });
    return saved;
  }

  /** Pure planning (no I/O) — used by generate and unit tests. */
  async plan(request: PlanRequest): Promise<AttackPlan> {
    const planId = newPlanId();
    const plan = this.deps.engine.build(planId, request);
    logger.info(
      { scanId: request.scanId, targets: plan.targets.length, covered: plan.coveredSurfaces },
      'planner.plan: built',
    );
    return plan;
  }

  private emit(scanId: string, input: Omit<AmassEventInput, 'scanId'>): void {
    if (!this.deps.events) return;
    try {
      this.deps.events.publish({ ...input, scanId });
    } catch (error) {
      logger.warn({ err: error }, 'planner.events: publish ignored');
    }
  }

  async getPlan(planId: string): Promise<AttackPlan> {
    const plan = await this.deps.repository.getPlan(planId);
    if (!plan) throw new PlanNotFoundError(planId);
    return plan;
  }

  async getPlanForScan(scanId: string): Promise<AttackPlan | null> {
    return this.deps.repository.getPlanForScan(scanId);
  }
}

function stripPlanIds(plan: AttackPlan) {
  const { id: _id, createdAt: _createdAt, scanId: _scanId, ...rest } = plan;
  return rest;
}