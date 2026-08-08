import type { Sandbox, SandboxHealth, SandboxStatus } from '../../src/sandbox/domain/models/sandbox';
import type { SandboxManager, CreateSandboxInput } from '../../src/sandbox/domain/ports/sandbox-manager';
import type { ExecRequest, ExecResult, SandboxPatch } from '../../src/sandbox/domain/models/sandbox';

/**
 * Minimal programmable SandboxManager for Sniper tests. Proves the Sniper
 * talks ONLY through this port — nothing Docker-specific exists here.
 */
export class StubSandboxManager implements SandboxManager {
  sandboxes = new Map<string, Sandbox>();
  /** Scripted exec results, consumed FIFO (default: empty success). */
  execQueue: ExecResult[] = [];
  execCalls: Array<{ sandboxId: string; request: ExecRequest; startedAt: number }> = [];
  failExecute = false;
  /** Latency applied to every execute() call (concurrency tests). */
  delayMs = 0;

  seed(sandbox: Sandbox): void {
    this.sandboxes.set(sandbox.id, sandbox);
  }

  async createSandbox(input: CreateSandboxInput): Promise<Sandbox> {
    throw new Error('stub does not create sandboxes');
  }
  async waitUntilSandbox(_id: string, _t?: number): Promise<Sandbox> {
    throw new Error('stub: not implemented');
  }
  async getSandbox(id: string): Promise<Sandbox | null> {
    return this.sandboxes.get(id) ?? null;
  }
  async healthCheck(id: string): Promise<SandboxHealth> {
    const sb = this.sandboxes.get(id);
    if (!sb) return { ok: false, status: 'pending' as SandboxStatus, reason: 'sandbox not found' };
    return { ok: sb.status !== 'destroyed' && sb.status !== 'failed', status: sb.status };
  }
  async execute(sandboxId: string, request: ExecRequest): Promise<ExecResult> {
    const startedAt = Date.now();
    this.execCalls.push({ sandboxId, request, startedAt });
    if (this.failExecute) throw new Error(`sandbox ${sandboxId} cannot execute (stub failure)`);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const next = this.execQueue.shift();
    return next ?? { stdout: '', stderr: '', exitCode: 0, timedOut: false };
  }
  async copyFile(_id: string, _s: string, _d: string): Promise<void> {}
  async applyPatch(_id: string, _patches: readonly SandboxPatch[]): Promise<Sandbox> {
    throw new Error('stub: not implemented');
  }
  async restart(_id: string): Promise<Sandbox> {
    throw new Error('stub: not implemented');
  }
  async *collectLogs(_id: string): AsyncIterable<string> {
    return;
  }
  async destroy(_id: string): Promise<void> {}
  async sweepOrphans(): Promise<number> {
    return 0;
  }
}