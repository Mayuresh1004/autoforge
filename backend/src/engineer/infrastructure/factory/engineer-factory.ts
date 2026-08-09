/**
 * Engineer infrastructure factory — composition root wiring the Engineer
 * agent's concrete adapters: Prisma patch/finding repositories, the source
 * reader over the EXISTING SandboxManager, RagService, PromptRegistry, and
 * the LLM provider (created by the caller from llmConfig). Lazy: no network
 * traffic until the engineer service actually runs.
 */

import type { PrismaClient } from '@prisma/client';
import type { AgentExecutionService } from '../../../agent/application/services/agent-execution.service';
import type { LLMProvider } from '../../../llm/domain/ports/llm-provider';
import type { AmassEventPublisher } from '../../../observability/domain/ports/event-bus';
import type { PromptRegistry } from '../../../prompts/domain/prompt-registry';
import type { RagService } from '../../../knowledge/application/services/rag.service';
import type { RuntimeSandboxStore } from '../../../sandbox/domain/ports/runtime-sandbox-store';
import type { SandboxManager } from '../../../sandbox/domain/ports/sandbox-manager';
import type { EngineerBounds } from '../../domain/models/engineer-response';
import { DEFAULT_ENGINEER_BOUNDS } from '../../domain/models/engineer-response';
import { DefaultEngineerService } from '../../application/services/engineer.service';
import type { EngineerService } from '../../application/services/engineer.service';
import { PrismaConfirmedFindingRepository } from '../repositories/prisma-confirmed-finding-repository';
import { PrismaEngineerPatchRepository } from '../repositories/prisma-patch-repository';
import { ManagerSourceReader } from '../source/manager-source-reader';

export interface EngineerConfig {
  readonly maxSourceBytes: number;
  readonly maxContextLines: number;
  readonly defaultContextWindow: number;
  readonly bounds: EngineerBounds;
  readonly ragTopK: number;
}

export interface EngineerInfrastructure {
  readonly engineer: EngineerService;
}

export interface CreateEngineerInfrastructureOptions {
  readonly prisma: PrismaClient;
  /** The application composition root's SINGLE shared manager — required so
   *  the Engineer reads source from runtime-created sandboxes. */
  readonly manager: SandboxManager;
  /** Runtime-sandbox store (existing Prisma-backed store). */
  readonly runtimeStore: RuntimeSandboxStore;
  readonly rag: RagService;
  readonly registry: PromptRegistry;
  readonly llm: LLMProvider;
  readonly executions: AgentExecutionService;
  readonly config: EngineerConfig;
  /** Phase 9 observability publisher (default: silent). */
  readonly events?: AmassEventPublisher;
}

export function createEngineerInfrastructure(
  options: CreateEngineerInfrastructureOptions,
): EngineerInfrastructure {
  const bounds = options.config.bounds ?? DEFAULT_ENGINEER_BOUNDS;

  const engineer: EngineerService = new DefaultEngineerService({
    findings: new PrismaConfirmedFindingRepository(options.prisma),
    patches: new PrismaEngineerPatchRepository(options.prisma),
    sourceReader: new ManagerSourceReader(options.manager, {
      maxSourceBytes: options.config.maxSourceBytes,
      maxContextLines: options.config.maxContextLines,
    }),
    rag: options.rag,
    registry: options.registry,
    llm: options.llm,
    executions: options.executions,
    runtimeStore: options.runtimeStore,
    events: options.events,
    bounds,
    maxSourceBytes: options.config.maxSourceBytes,
    maxContextLines: options.config.maxContextLines,
    defaultContextWindow: options.config.defaultContextWindow,
    ragTopK: options.config.ragTopK,
  });

  return { engineer };
}