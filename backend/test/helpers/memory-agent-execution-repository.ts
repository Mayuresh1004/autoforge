/**
 * In-memory AgentExecutionRepository for offline tests. Records sanitized
 * inputs exactly as persisted (the service sanitizes BEFORE this point).
 */

import type {
  AgentExecutionDetail,
  AgentExecutionInput,
  AgentExecutionRecord,
  AgentExecutionRepository,
} from '../../src/agent/application/services/agent-execution.service';

export class MemoryAgentExecutionRepository implements AgentExecutionRepository {
  private readonly records: Array<AgentExecutionRecord & { persisted?: AgentExecutionDetail }> = [];

  async save(input: AgentExecutionInput): Promise<AgentExecutionRecord> {
    const record: AgentExecutionRecord = {
      id: `exec-${this.records.length + 1}`,
      scanId: input.scanId,
      agentType: input.agentType,
      status: input.status,
      createdAt: new Date().toISOString(),
    };
    const detail: AgentExecutionDetail = {
      ...record,
      inputMetadata: input.inputMetadata,
      outputMetadata: input.outputMetadata,
      errorMessage: input.errorMessage ?? null,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
    };
    (record as unknown as Record<string, unknown>)['__persisted'] = detail;
    this.records.push(record as AgentExecutionRecord & { __persisted: AgentExecutionDetail });
    return record;
  }

  async find(executionId: string): Promise<AgentExecutionDetail | null> {
    const found = this.records.find((r) => r.id === executionId);
    if (!found) return null;
    return (found as unknown as { __persisted?: AgentExecutionDetail }).__persisted ?? null;
  }

  all(): Array<AgentExecutionRecord & { __persisted?: unknown }> {
    return [...this.records];
  }
}