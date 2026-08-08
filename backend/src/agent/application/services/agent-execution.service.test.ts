import { describe, expect, it } from 'vitest';
import { DefaultAgentExecutionService } from './agent-execution.service';
import { MemoryAgentExecutionRepository } from '../../../../test/helpers/memory-agent-execution-repository';

describe('DefaultAgentExecutionService', () => {
  it('records a terminal agent execution', async () => {
    const repo = new MemoryAgentExecutionRepository();
    const service = new DefaultAgentExecutionService(repo);
    const record = await service.record({
      scanId: 'scan-1',
      agentType: 'SNIPER',
      status: 'COMPLETED',
      inputMetadata: { targetId: 't1', attempt: 2 },
      outputMetadata: { status: 'CONFIRMED' },
    });
    expect(record.scanId).toBe('scan-1');
    expect(record.agentType).toBe('SNIPER');
    expect(record.status).toBe('COMPLETED');
  });

  it('sanitizes secrets BEFORE persistence (keys/ tokens / passwords redacted)', async () => {
    const repo = new MemoryAgentExecutionRepository();
    const service = new DefaultAgentExecutionService(repo);
    await service.record({
      scanId: 'scan-1',
      agentType: 'ENGINEER',
      status: 'FAILED',
      inputMetadata: { api_key: 'sk-live-123', target: 'https://x' },
      outputMetadata: { authorization: 'Bearer abc', token: 'tok-1', ok: true },
    });
    const persisted = repo.all()[0] as unknown as { __persisted: { inputMetadata: Record<string, unknown>; outputMetadata: Record<string, unknown> } };
    expect(persisted.__persisted.inputMetadata.api_key).toBe('[REDACTED]');
    expect(String(persisted.__persisted.inputMetadata.api_key)).not.toContain('sk-');
    expect(persisted.__persisted.outputMetadata.authorization).toBe('[REDACTED]');
    expect(persisted.__persisted.outputMetadata.token).toBe('[REDACTED]');
    expect(persisted.__persisted.outputMetadata.ok).toBe(true);
  });

  it('truncates long metadata values (no huge blobs)', () => {
    const service = new DefaultAgentExecutionService(new MemoryAgentExecutionRepository());
    const sanitized = service.sanitizeMetadata({ diff: 'x'.repeat(50_000) }) as Record<string, unknown>;
    expect((sanitized.diff as string).length).toBeLessThanOrEqual(1_001);
  });

  it('sanitizeMetadata handles nested objects and arrays', () => {
    const service = new DefaultAgentExecutionService(new MemoryAgentExecutionRepository());
    const sanitized = service.sanitizeMetadata({
      list: ['a', 'b', { secret: 's', keep: 1 }],
      apiKey: 'k1',
      fine: 'hello',
    }) as Record<string, unknown>;
    expect(sanitized.fine).toBe('hello');
    expect(sanitized.apiKey).toBe('[REDACTED]');
    const list = sanitized.list as unknown[];
    expect(list).toHaveLength(3);
    expect((list[2] as Record<string, unknown>).secret).toBe('[REDACTED]');
  });

  it('keeps error messages bounded', async () => {
    const repo = new MemoryAgentExecutionRepository();
    const service = new DefaultAgentExecutionService(repo);
    await service.record({ scanId: 's', agentType: 'SCOUT', status: 'FAILED', errorMessage: 'e'.repeat(20_000) });
    const persisted = repo.all()[0] as unknown as { __persisted: { errorMessage: string | null } };
    expect(persisted.__persisted.errorMessage?.length).toBeLessThanOrEqual(2_001);
  });
});