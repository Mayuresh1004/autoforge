/**
 * Usage ledger for LLM calls.
 *
 * Every generate() attempt records: provider, model, tokens, estimated cost,
 * duration and status — the data needed to later compare latency, token
 * usage, success rate and (once patches exist) patch quality across
 * providers. Cost is 0 unless the provider explicitly reports a figure;
 * AMASS never invents pricing.
 *
 * The ledger is in-memory and bounded (ring buffer). A durable export is a
 * decision for a later milestone, not this one.
 */

export type LLMUsageStatus = 'ok' | 'error';

export interface LLMUsageRecord {
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCost: number;
  /** Wall-clock time of the attempt (ms, total across internal retries). */
  readonly durationMs: number;
  readonly status: LLMUsageStatus;
  /** Stable error code when status is 'error' (never free-form text). */
  readonly errorCode?: string;
  readonly attemptedAt: number;
}

export interface LLMUsageRecorder {
  record(usage: LLMUsageRecord): void;
  /** Newest first. */
  snapshot(): readonly LLMUsageRecord[];
  clear(): void;
}

export const DEFAULT_USAGE_CAPACITY = 10_000;

export class InMemoryLLMUsageRecorder implements LLMUsageRecorder {
  private readonly capacity: number;
  private readonly records: LLMUsageRecord[] = [];

  constructor(capacity: number = DEFAULT_USAGE_CAPACITY) {
    this.capacity = Math.max(1, capacity);
  }

  record(usage: LLMUsageRecord): void {
    this.records.push(usage);
    if (this.records.length > this.capacity) {
      this.records.splice(0, this.records.length - this.capacity);
    }
  }

  snapshot(): readonly LLMUsageRecord[] {
    return [...this.records].reverse();
  }

  clear(): void {
    this.records.length = 0;
  }
}