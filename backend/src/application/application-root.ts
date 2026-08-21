/**
 * Application composition root — the ONE place that owns the SandboxManager
 * and the whole agent infrastructure.
 *
 * Before this module existed, runtime-sandbox.routes, engineer.routes,
 * critic.routes and sniper.routes each called `createSandboxInfrastructure()`
 * themselves, so an agent could never see a sandbox created through the
 * runtime HTTP surface ("sandbox not found" in production wiring). Now every
 * consumer receives the SAME manager instance created here exactly once:
 *
 *   runtime (create/health/destroy) → sniper → engineer → critic
 *
 * There is deliberately NO global SandboxManager singleton — the root is the
 * only place that constructs one; tests inject a manager to prove the
 * sharing property. Boot is lazy: nothing touches Docker/Postgres/network at
 * import or construction time. The LLM provider is created on first use so a
 * missing API key can never crash service boot (MEDIUM-5 resolution).
 *
 * Route modules consume the singleton built by the bootstrap module
 * (`src/application/application.ts`), which injects the shared Prisma client;
 * this file itself never imports a live PrismaClient so the default test
 * suite stays DB-free.
 */

import type { PrismaClient } from '@prisma/client';
import type { SandboxManager } from '../sandbox/domain/ports/sandbox-manager';
import { createSandboxInfrastructure } from '../sandbox/infrastructure/factory/sandbox-factory';
import type { RuntimeSandboxInfrastructure } from '../sandbox/infrastructure/factory/runtime-sandbox-factory';
import { createRuntimeSandboxInfrastructure } from '../sandbox/infrastructure/factory/runtime-sandbox-factory';
import type { RuntimeSandboxStore } from '../sandbox/domain/ports/runtime-sandbox-store';
import type { SniperService } from '../sniper/domain/ports/sniper-service';
import type { SniperRepository } from '../sniper/domain/ports/sniper-repository';
import { createSniperInfrastructure } from '../sniper/infrastructure/factory/sniper-factory';
import type { EngineerService } from '../engineer/application/services/engineer.service';
import type { EngineerConfig } from '../engineer/infrastructure/factory/engineer-factory';
import { createEngineerInfrastructure } from '../engineer/infrastructure/factory/engineer-factory';
import type { CriticService } from '../critic/application/services/critic.service';
import type { CriticConfig, CriticInfrastructure } from '../critic/infrastructure/factory/critic-factory';
import { createCriticInfrastructure } from '../critic/infrastructure/factory/critic-factory';
import type { RagService } from '../knowledge/application/services/rag.service';
import type { PromptRegistry } from '../prompts/domain/prompt-registry';
import { FileSystemPromptRegistry, resolvePromptsRoot } from '../prompts/infrastructure/fs-prompt-registry';
import { promptsConfig, engineerConfig as defaultEngineerConfig, criticConfig as defaultCriticConfig } from '../config';
import type { LLMProvider } from '../llm/domain/ports/llm-provider';
import type { LLMRequest, LLMResponse } from '../llm/domain/ports/llm-provider';
import { createLLMProvider } from '../llm/infrastructure/factory/llm-provider-factory';
import { llmConfig } from '../config';
import type { AgentExecutionService } from '../agent/application/services/agent-execution.service';
import { DefaultAgentExecutionService } from '../agent/application/services/agent-execution.service';
import { PrismaAgentExecutionRepository } from '../agent/infrastructure/repositories/prisma-agent-execution-repository';
import { createKnowledgeInfrastructure } from '../knowledge/infrastructure/factory/knowledge-factory';
import { embeddingConfig, knowledgeConfig } from '../config';
import type { EventBus, AmassEventPublisher } from '../observability/domain/ports/event-bus';
import { InMemoryEventBus } from '../observability/application/in-memory-event-bus';
import { eventsConfig } from '../config';
import type { ScoutService } from '../scout/domain/ports/scout-service';
import { createScoutService } from '../scout/infrastructure/factory/scout-factory';
import type { PlannerService } from '../planner/domain/ports/planner';
import { createPlannerService } from '../planner/infrastructure/factory/plan-factory';
import { PrismaPlanRepository } from '../planner/infrastructure/repository/prisma-plan-repository';
import { AutonomousPipelineService } from './services/autonomous-pipeline.service';

export interface ApplicationRootOptions {
  /** Shared Prisma client (injected by the bootstrap module). */
  readonly db?: PrismaClient;
  /** The SINGLE SandboxManager for the whole application. Tests inject a
   *  programmable instance to prove the sharing property. */
  readonly manager?: SandboxManager;
  /** Runtime-sandbox lifecycle overrides (store/prober/gateway/workspace). */
  readonly runtime?: Omit<Parameters<typeof createRuntimeSandboxInfrastructure>[0], 'manager' | 'db'>;
  /** Sniper repository override (default: Prisma). */
  readonly sniperRepository?: SniperRepository;
  /** RAG service override (default: Qdrant knowledge root). */
  readonly rag?: RagService;
  /** Prompt registry override (default: filesystem v1 prompts). */
  readonly registry?: PromptRegistry;
  /**
   * LLM provider override. `null` disables advisory review; `undefined`
   * (default) installs a LAZY provider constructed only on first use.
   */
  readonly llm?: LLMProvider | null;
  /** Agent execution recording override (default: Prisma-backed). */
  readonly executions?: AgentExecutionService;
  readonly engineerConfig?: EngineerConfig;
  readonly criticConfig?: CriticConfig;
  /** Observability overrides (default: in-memory bus with config bounds). */
  readonly events?: { readonly bus?: EventBus };
}

export interface ApplicationInfrastructure {
  readonly manager: SandboxManager;
  readonly runtime: RuntimeSandboxInfrastructure;
  readonly scout: ScoutService;
  readonly planner: PlannerService;
  readonly sniper: { readonly service: SniperService };
  readonly engineer: { readonly engineer: EngineerService };
  readonly critic: CriticInfrastructure;
  readonly pipeline: AutonomousPipelineService;
  readonly rag: RagService;
  readonly registry: PromptRegistry;
  readonly llm: LLMProvider | null;
  readonly executions: AgentExecutionService;
  /** Phase 9 observability: the single EventBus + the narrow publisher. */
  readonly events: { readonly bus: EventBus; readonly publisher: AmassEventPublisher };
}

/** Lazy LLM provider — construction deferred until the first call so a
 *  missing provider key/model can never crash service boot; the factory
 *  error then surfaces as a normal run-time 502, never a startup failure. */
function lazyLLMProvider(): LLMProvider {
  let provider: LLMProvider | undefined;
  const resolve = (): LLMProvider => {
    provider ??= createLLMProvider(llmConfig);
    return provider;
  };
  return {
    generate: (request: LLMRequest): Promise<LLMResponse> => resolve().generate(request),
    healthCheck: () => resolve().healthCheck(),
    getModelInfo: () => resolve().getModelInfo(),
  };
}

export function createApplicationInfrastructure(
  options: ApplicationRootOptions = {}
): ApplicationInfrastructure {
  const db = options.db!;
  // ONE event bus for the whole application (ephemeral, bounded — see the
  // observability module header for the persistence decision).
  const bus =
    options.events?.bus ??
    new InMemoryEventBus({
      ringPerScan: eventsConfig.ringPerScan,
      maxScans: eventsConfig.maxScans,
      messageMaxChars: eventsConfig.messageMaxChars,
      metadataMaxBytes: eventsConfig.metadataMaxBytes,
    });
  const publisher: AmassEventPublisher = bus;
  const manager =
    options.manager ??
    createSandboxInfrastructure({
      runtime: (process.env.SANDBOX_RUNTIME as 'docker' | 'process' | undefined) ?? 'docker',
    }).manager;

  // Runtime sandbox lifecycle — the single shared manager.
  const runtime = createRuntimeSandboxInfrastructure({ ...options.runtime, manager, db, events: publisher });

  // Shared cross-agent ports (single instances, not per-route).
  const registry =
    options.registry ?? new FileSystemPromptRegistry(resolvePromptsRoot(promptsConfig.root));
  const llm = options.llm === undefined ? lazyLLMProvider() : options.llm;
  // The Engineer always needs a provider (patch generation); `null` only
  // disables the Critic's ADVISORY review, not the Engineer's core path.
  const engineerLLM = llm ?? lazyLLMProvider();
  const executions =
    options.executions ?? new DefaultAgentExecutionService(new PrismaAgentExecutionRepository(db));
  const rag =
    options.rag ??
    createKnowledgeInfrastructure(
      { embedding: embeddingConfig, nvd: knowledgeConfig.nvd, qdrant: knowledgeConfig.qdrant },
      db
    ).rag;

  // Sniper agent — the single shared manager.
  const sniper = createSniperInfrastructure({
    manager,
    repository: options.sniperRepository,
    events: publisher,
    rag,
  });

  const engineerConfig = options.engineerConfig ?? defaultEngineerConfig;
  const criticConfig = options.criticConfig ?? defaultCriticConfig;

  // Engineer agent — same manager, same runtime store the HTTP surface writes.
  const engineer = createEngineerInfrastructure({
    prisma: db,
    manager,
    runtimeStore: runtime.store,
    rag,
    registry,
    llm: engineerLLM,
    executions,
    config: engineerConfig,
    events: publisher,
  });

  // Critic agent — same manager, same runtime service, same sniper.
  const critic = createCriticInfrastructure({
    prisma: db,
    runtimeService: runtime.service,
    manager,
    sniper: sniper.service,
    registry,
    llm,
    executions,
    engineer: engineer.engineer,
    config: criticConfig,
    events: publisher,
  });

  const scout = createScoutService({ events: publisher });
  const planner = createPlannerService(new PrismaPlanRepository(), { events: publisher });
  const pipeline = new AutonomousPipelineService({
    manager,
    runtime: runtime.service,
    scout,
    planner,
    sniper: sniper.service,
    engineer: engineer.engineer,
    critic: critic.service,
    events: publisher,
    prisma: db,
  });

  return { manager, runtime, scout, planner, sniper, engineer, critic, pipeline, rag, registry, llm, executions, events: { bus, publisher } };
}