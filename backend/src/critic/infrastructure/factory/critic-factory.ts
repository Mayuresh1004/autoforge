/**
 * Critic module composition root — wires the Critic agent's concrete
 * adapters: Prisma patch/finding/repositories, the sandbox steps over the
 * EXISTING SandboxManager + RuntimeSandboxService (the ONLY runtime seams),
 * SniperService for exploit re-verification, PromptRegistry + LLMProvider
 * for the advisory review, and the bounded remediation loop.
 *
 * Lazy: nothing touches Docker/database/network until a run happens.
 */

import type { PrismaClient } from '@prisma/client';
import type { AmassEventPublisher } from '../../../observability/domain/ports/event-bus';
import type { RuntimeSandboxService } from '../../../sandbox/domain/ports/runtime-sandbox-service';
import type { SandboxManager } from '../../../sandbox/domain/ports/sandbox-manager';
import type { SniperService } from '../../../sniper/domain/ports/sniper-service';
import type { LLMProvider } from '../../../llm/domain/ports/llm-provider';
import type { PromptRegistry } from '../../../prompts/domain/prompt-registry';
import type { AgentExecutionService } from '../../../agent/application/services/agent-execution.service';
import type { EngineerService } from '../../../engineer/application/services/engineer.service';
import { ManagerSourceReader } from '../../../engineer/infrastructure/source/manager-source-reader';
import { DefaultCriticService } from '../../application/services/critic.service';
import type { CriticService } from '../../application/services/critic.service';
import { CriticSteps } from '../../application/services/critic-steps';
import { CriticOutcomeWriter } from '../../application/services/critic-outcome';
import { RemediationLoopService } from '../../application/services/remediation-loop.service';
import { SandboxPatchApplier } from '../../application/services/patch-applier';
import { CriticBuildCheck } from '../../application/services/build-check';
import { CriticRegressionTestRunner } from '../../application/services/test-runner';
import { CriticSecurityReviewGate } from '../../application/services/security-review-gate';
import { CriticAdvisoryReviewer } from '../../application/services/llm-review';
import { PrismaCriticRepository } from '../persistence/prisma-critic-repository';
import { PrismaPatchReviewRepository } from '../persistence/prisma-patch-review-repository';
import { PrismaCriticFindingResolver } from '../persistence/prisma-critic-finding-resolver';
import { CriticEventCollector } from '../observability/critic-event-collector';

export interface CriticConfig {
  readonly maxPatchBytes: number;
  readonly maxSourceBytes: number;
  readonly checkTimeoutMs: number;
  readonly testTimeoutMs: number;
  readonly retestTimeoutMs: number;
  readonly advisoryEnabled: boolean;
  readonly maxEngineerRetries: number;
}

export interface CriticInfrastructureOptions {
  readonly prisma: PrismaClient;
  /** Runtime lifecycle seam from the composition root. */
  readonly runtimeService: RuntimeSandboxService;
  /** The application composition root's SINGLE shared manager — required so
   *  the Critic applier/build/test hit runtime-created sandboxes. */
  readonly manager: SandboxManager;
  readonly sniper: SniperService;
  readonly registry: PromptRegistry;
  readonly llm: LLMProvider | null;
  readonly executions: AgentExecutionService;
  readonly engineer: EngineerService;
  readonly config: CriticConfig;
  /** Phase 9 observability publisher (default: silent). */
  readonly events?: AmassEventPublisher;
}

export interface CriticInfrastructure {
  readonly critic: CriticService;
  readonly loop: RemediationLoopService;
  /** Backend observability events (bounded; frontend transport later). */
  readonly events: CriticEventCollector;
}

export function createCriticInfrastructure(options: CriticInfrastructureOptions): CriticInfrastructure {
  const manager = options.manager;
  const runtimeService = options.runtimeService;
  const events = new CriticEventCollector();

  const reader = new ManagerSourceReader(manager, {
    maxSourceBytes: options.config.maxSourceBytes,
    maxContextLines: 2_000,
  });
  const applier = new SandboxPatchApplier(manager, reader, {
    maxPatchBytes: options.config.maxPatchBytes,
    maxSourceBytes: options.config.maxSourceBytes,
  });
  const buildCheck = new CriticBuildCheck(manager, {
    timeoutMs: options.config.checkTimeoutMs,
    maxOutputChars: 400,
  });
  const testRunner = new CriticRegressionTestRunner(manager, {
    timeoutMs: options.config.testTimeoutMs,
    maxOutputChars: 600,
  });

  const steps = new CriticSteps({
    runtimeService,
    sniper: options.sniper,
    applier,
    buildCheck,
    testRunner,
    securityGate: new CriticSecurityReviewGate(),
    llmReview: new CriticAdvisoryReviewer(options.llm, options.registry),
    events,
    config: {
      checkTimeoutMs: options.config.checkTimeoutMs,
      testTimeoutMs: options.config.testTimeoutMs,
      retestTimeoutMs: options.config.retestTimeoutMs,
      advisoryEnabled: options.config.advisoryEnabled,
    },
  });

  const criticRepository = new PrismaCriticRepository(options.prisma);
  const critic: CriticService = new DefaultCriticService({
    patches: new PrismaPatchReviewRepository(options.prisma),
    findings: new PrismaCriticFindingResolver(options.prisma),
    steps,
    events,
    eventsBridge: options.events,
    outcomes: new CriticOutcomeWriter(criticRepository, options.executions),
    results: criticRepository,
  });

  const loop = new RemediationLoopService({
    engineer: options.engineer,
    critic,
    maxEngineerAttempts: 1 + Math.max(0, options.config.maxEngineerRetries),
  });

  return { critic, loop, events };
}