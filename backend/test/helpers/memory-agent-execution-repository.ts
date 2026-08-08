/**
 * In-memory AgentExecutionRepository for offline tests. Records sanitized
 * inputs exactly as persisted (the service sanitizes BEFORE this point).
 */

import type {
  AgentExecutionInput,
  AgentExecutionRecord,
  AgentExecutionRepository,
} from '../../src/agent/application/services/agent-execution.service';

export class MemoryAgentExecutionRepository implements AgentExecutionRepository {
  private readonly records: AgentExecutionRecord[] = [];

  async save(input: AgentExecutionInput): Promise<AgentExecutionRecord> {
    const record: AgentExecutionRecord = {
      id: `exec-${this.records.length + 1}`,
      scanId: input.scanId,
      agentType: input.agentType,
      status: input.status,
      createdAt: new Date().toISOString(),
    };
    // Keep the sanitized payload alongside for assertions.
    (record as unknown as Record<string, unknown>)['__persisted'] = {
      inputMetadata: input.inputMetadata,
      outputMetadata: input.outputMetadata,
      errorMessage: input.errorMessage,
    };
    this.records.push(record);
    return record;
  }

  all(): Array<AgentExecutionRecord & { __persisted?: unknown }> {
    return [...this.records];
  }
}