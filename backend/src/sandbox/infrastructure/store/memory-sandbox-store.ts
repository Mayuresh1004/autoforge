import type { Sandbox } from '../../domain/models/sandbox';
import type { SandboxStore } from '../../domain/ports/sandbox-manager';

/** In-memory SandboxStore for tests and headless runs (no DB required). */
export class MemorySandboxStore implements SandboxStore {
  private readonly sandboxes = new Map<string, Sandbox>();

  async save(sandbox: Sandbox): Promise<void> {
    this.sandboxes.set(sandbox.id, { ...sandbox });
  }
  async get(id: string): Promise<Sandbox | null> {
    return this.sandboxes.get(id) ?? null;
  }
  async list(): Promise<readonly Sandbox[]> {
    return [...this.sandboxes.values()];
  }
  async remove(id: string): Promise<void> {
    this.sandboxes.delete(id);
  }
}