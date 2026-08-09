import type { PlannerService } from '../../domain/ports/planner';
import type { PlanRepository } from '../../domain/ports/plan-repository';
import type { AmassEventPublisher } from '../../../observability/domain/ports/event-bus';
import { AttackPlanService, type PlannerDeps } from '../../application/services/attack-plan.service';
import { PlanEngine } from '../../application/ranking/plan-engine';
import { TargetScorer } from '../../application/scoring/target-scorer';

/** Compose the planner with the real (Prisma) repository, following the
 * project's composition-root pattern. */
export function createPlannerService(
  repository: PlanRepository,
  options: { readonly events?: AmassEventPublisher } = {},
): PlannerService {
  const deps: PlannerDeps = {
    repository,
    engine: new PlanEngine(new TargetScorer()),
    events: options.events,
  };
  return new AttackPlanService(deps);
}

export { PlanEngine, TargetScorer, AttackPlanService };