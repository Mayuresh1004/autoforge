/**
 * Engineer routes — composition root (module singleton, matching
 * knowledge/sandbox patterns). Everything is lazy: the LLM provider,
 * source reader and repositories are constructed here but nothing touches
 * the network until a handler runs.
 *
 * POST  /api/engineer/run
 * GET   /api/engineer/:executionId
 */

import { Router } from 'express';
import { prisma } from '../../../config/database';
import { engineerConfig, llmConfig, promptsConfig } from '../../../config';
import { createLLMProvider } from '../../../llm/infrastructure/factory/llm-provider-factory';
import { resolvePromptsRoot } from '../../../prompts/infrastructure/fs-prompt-registry';
import { FileSystemPromptRegistry } from '../../../prompts/infrastructure/fs-prompt-registry';
import { DefaultAgentExecutionService } from '../../../agent/application/services/agent-execution.service';
import { PrismaAgentExecutionRepository } from '../../../agent/infrastructure/repositories/prisma-agent-execution-repository';
import { knowledgeInfrastructure } from '../../../knowledge/presentation/routes/knowledge.routes';
import { runtimeSandboxInfrastructure } from '../../../sandbox/presentation/routes/runtime-sandbox.routes';
import { createEngineerInfrastructure } from '../../infrastructure/factory/engineer-factory';
import { EngineerController } from '../controllers/engineer.controller';

const infrastructure = createEngineerInfrastructure({
  prisma,
  runtimeStore: runtimeSandboxInfrastructure.store,
  rag: knowledgeInfrastructure.rag,
  registry: new FileSystemPromptRegistry(resolvePromptsRoot(promptsConfig.root)),
  llm: createLLMProvider(llmConfig),
  executions: new DefaultAgentExecutionService(new PrismaAgentExecutionRepository(prisma)),
  config: engineerConfig,
});

const controller = new EngineerController(infrastructure.engineer);

const router = Router();

router.post('/engineer/run', controller.run);
router.get('/engineer/:executionId', controller.getRun);

export { router as engineerRoutes };
export { infrastructure as engineerInfrastructure };