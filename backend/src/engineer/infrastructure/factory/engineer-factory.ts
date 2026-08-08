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
import type { PromptRegistry } from '../../../prompts/domain/prompt-registry';
import type { RagService } from '../../../knowledge/application/services/rag.service';
import type { RuntimeSandboxStore } from '../../../sandbox/domain/ports/runtime-sandbox-store';
import type { SandboxManager } from '../../../sandbox/domain/ports/sandbox-manager';
import { createSandboxInfrastructure } from '../../../sandbox/infrastructure/factory/sandbox-factory';
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
  /** SandboxManager — inject for tests; default is the Docker manager. */
  readonly manager?: SandboxManager;
  /** Runtime-sandbox store (existing Prisma-backed store). */
  readonly runtimeStore: RuntimeSandboxStore;
  readonly rag: RagService;
  readonly registry: PromptRegistry;
  readonly llm: LLMProvider;
  readonly executions: AgentExecutionService;
  readonly config: EngineerConfig;
}

export function createEngineerInfrastructure(
  options: CreateEngineerInfrastructureOptions,
): EngineerInfrastructure {
  const manager = options.manager ?? createSandboxInfrastructure({ runtime: 'docker' }).manager;
  const bounds = options.config.bounds ?? DEFAULT_ENGINEER_BOUNDS;

  const engineer: EngineerService = new DefaultEngineerService({
    findings: new PrismaConfirmedFindingRepository(options.prisma),
    patches: new PrismaEngineerPatchRepository(options.prisma),
    sourceReader: new ManagerSourceReader(manager, {
      maxSourceBytes: options.config.maxSourceBytes,
      maxContextLines: options.config.maxContextLines,
    }),
    rag: options.rag,
    registry: options.registry,
    llm: options.llm,
    executions: options.executions,
    runtimeStore: options.runtimeStore,
    bounds,
    maxSourceBytes: options.config.maxSourceBytes,
    maxContextLines: options.config.maxContextLines,
    defaultContextWindow: options.config.defaultContextWindow,
    ragTopK: options.config.ragTopK,
  });

  return { engineer };
}