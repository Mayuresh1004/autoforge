import type { ToolExecRequest, ToolExecResult, ToolRuntime } from '../../src/sniper/domain/ports/tool-runtime';

export type OutputOrFactory = ToolExecResult | (() => ToolExecResult);

/** Scripted in-memory runtime for headless Sniper tests. */
export class FakeToolRuntime implements ToolRuntime {
  readonly calls: ToolExecRequest[] = [];
  private readonly queue: OutputResult[] = [];
  /** Per-call latency; also used by the concurrency test to hold slots. */
  delayMs = 0;
  private inFlight = 0;
  private everInFlight = 0;
  /** Fired for every execute() — lets tests assert argv/network policy. */
  onCall: ((request: ToolExecRequest) => void) | undefined;

  /** Queue outputs; each execute() consumes the next (or falls back). */
  script(...outputs: OutputResult[]): void {
    this.queue.push(...outputs);
  }

  async execute(request: ToolExecRequest): Promise<ToolExecResult> {
    this.calls.push(request);
    this.onCall?.(request);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.inFlight += 1;
    this.everInFlight = Math.max(this.everInFlight, this.inFlight);
    try {
      const next = this.queue.shift() ?? this.emptyResult();
      return typeof next === 'function' ? next() : next;
    } finally {
      this.inFlight -= 1;
    }
  }

  /** Highest number of simultaneous executions observed. */
  get maxConcurrent(): number {
    return this.everInFlight;
  }

  private emptyResult(): ToolExecResult {
    return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
  }
}

export function execResult(overrides: Partial<ToolExecResult> = {}): ToolExecResult {
  return { stdout: '', stderr: '', exitCode: 0, timedOut: false, ...overrides };
}