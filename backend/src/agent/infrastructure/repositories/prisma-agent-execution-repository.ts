/**
 * Prisma-backed AgentExecution repository. Maps domain AgentExecutionInput to
 * the existing Prisma `AgentExecution` model — scanId is required (Cascade
 * delete), metadata stored as Json. No schema changes.
 */

import type { PrismaClient } from '@prisma/client';
import type {
  AgentExecutionInput,
  AgentExecutionRecord,
  AgentExecutionRepository,
} from '../../application/services/agent-execution.service';

export class PrismaAgentExecutionRepository implements AgentExecutionRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async save(input: AgentExecutionInput): Promise<AgentExecutionRecord> {
    const row = await this.prisma.agentExecution.create({
      data: {
        scanId: input.scanId,
        agentType: input.agentType,
        status: input.status,
        input: (input.inputMetadata ?? {}) as never,
        output: (input.outputMetadata ?? {}) as never,
        errorMessage: input.errorMessage ?? null,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
      },
    });
    return {
      id: row.id,
      scanId: row.scanId,
      agentType: row.agentType,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }
}