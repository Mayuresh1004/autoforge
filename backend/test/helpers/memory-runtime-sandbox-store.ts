import type {
  RuntimeSandbox,
  RuntimeSandboxStatus,
} from '../../src/sandbox/domain/entities/runtime-sandbox';
import type { RuntimeSandboxStore } from '../../src/sandbox/domain/ports/runtime-sandbox-store';

/** In-memory twin of the Prisma store for headless unit tests. */
export class MemoryRuntimeSandboxStore implements RuntimeSandboxStore {
  private readonly rows = new Map<string, RuntimeSandbox>();

  async save(sandbox: RuntimeSandbox): Promise<void> {
    this.rows.set(sandbox.id, sandbox);
  }

  async get(id: string): Promise<RuntimeSandbox | null> {
    return this.rows.get(id) ?? null;
  }

  async listByScan(scanId: string): Promise<readonly RuntimeSandbox[]> {
    return [...this.rows.values()].filter((s) => s.scanId === scanId);
  }

  async listByStatus(statuses: readonly RuntimeSandboxStatus[]): Promise<readonly RuntimeSandbox[]> {
    return [...this.rows.values()].filter((s) => statuses.includes(s.status));
  }

  async remove(id: string): Promise<void> {
    this.rows.delete(id);
  }

  all(): readonly RuntimeSandbox[] {
    return [...this.rows.values()];
  }
}