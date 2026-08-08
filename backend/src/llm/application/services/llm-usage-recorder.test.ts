/**
 * Usage ledger tests: bounded ring buffer, newest-first snapshot, clear, and
 * zero-cost default (no invented pricing).
 */

import { describe, expect, it } from 'vitest';
import { InMemoryLLMUsageRecorder, type LLMUsageRecord } from './llm-usage-recorder';

function record(partial: Partial<LLMUsageRecord> = {}): LLMUsageRecord {
  return {
    provider: 'openrouter',
    model: 'openrouter/free',
    inputTokens: 10,
    outputTokens: 5,
    estimatedCost: 0,
    durationMs: 250,
    status: 'ok',
    attemptedAt: 1_000,
    ...partial,
  };
}

describe('InMemoryLLMUsageRecorder', () => {
  it('records a success with zero cost when the provider reports none', () => {
    const recorder = new InMemoryLLMUsageRecorder();
    recorder.record(record());
    const snapshot = recorder.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      provider: 'openrouter',
      model: 'openrouter/free',
      estimatedCost: 0,
      status: 'ok',
    });
  });

  it('records error attempts with a stable error code', () => {
    const recorder = new InMemoryLLMUsageRecorder();
    recorder.record(record({ status: 'error', errorCode: 'RATE_LIMIT' }));
    expect(recorder.snapshot()[0].errorCode).toBe('RATE_LIMIT');
  });

  it('returns newest first', () => {
    const recorder = new InMemoryLLMUsageRecorder();
    recorder.record(record({ attemptedAt: 1 }));
    recorder.record(record({ attemptedAt: 2 }));
    const snapshot = recorder.snapshot();
    expect(snapshot.map((r) => r.attemptedAt)).toEqual([2, 1]);
  });

  it('is bounded by capacity (never grows unbounded)', () => {
    const recorder = new InMemoryLLMUsageRecorder(3);
    for (let i = 0; i < 10; i += 1) {
      recorder.record(record({ attemptedAt: i }));
    }
    expect(recorder.snapshot()).toHaveLength(3);
    expect(recorder.snapshot().map((r) => r.attemptedAt)).toEqual([9, 8, 7]);
  });

  it('clear() empties the ledger', () => {
    const recorder = new InMemoryLLMUsageRecorder();
    recorder.record(record());
    recorder.clear();
    expect(recorder.snapshot()).toHaveLength(0);
  });
});