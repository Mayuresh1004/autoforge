import type { RuntimeSandbox, RuntimeSandboxStatus } from '../entities/runtime-sandbox';

/**
 * Durable storage for runtime sandbox records (Prisma implementation).
 * Lifecycle metadata persists across process restarts so failed/expired
 * sandboxes can always be identified and cleaned.
 */
export interface RuntimeSandboxStore {
  save(sandbox: RuntimeSandbox): Promise<void>;
  get(id: string): Promise<RuntimeSandbox | null>;
  listByScan(scanId: string): Promise<readonly RuntimeSandbox[]>;
  listByStatus(statuses: readonly RuntimeSandboxStatus[]): Promise<readonly RuntimeSandbox[]>;
  remove(id: string): Promise<void>;
}