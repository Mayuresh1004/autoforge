import type { RuntimeSandbox } from '../../domain/entities/runtime-sandbox';
import type { RuntimeSandboxRegistry } from '../../domain/ports/runtime-sandbox-registry';

/**
 * In-process registry of LIVE runtime sandboxes — the accounting layer for
 * the concurrency ceiling. `register()` claims a slot at CREATING; every
 * terminal transition removes it. Not durable by design: after a restart the
 * durable store + expiry reclaim own the cleanup story.
 */
export class MemoryRuntimeSandboxRegistry implements RuntimeSandboxRegistry {
  private readonly live = new Map<string, RuntimeSandbox>();

  async register(sandbox: RuntimeSandbox): Promise<void> {
    this.live.set(sandbox.id, sandbox);
  }

  async get(id: string): Promise<RuntimeSandbox | null> {
    return this.live.get(id) ?? null;
  }

  async remove(id: string): Promise<void> {
    this.live.delete(id);
  }

  async listActive(): Promise<readonly RuntimeSandbox[]> {
    return [...this.live.values()];
  }

  async countActive(): Promise<number> {
    return this.live.size;
  }
}