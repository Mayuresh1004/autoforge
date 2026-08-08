import type { PrismaClient } from '@prisma/client';
import type {
  RuntimeSandbox,
  RuntimeSandboxStatus,
} from '../../domain/entities/runtime-sandbox';
import type { RuntimeSandboxStore } from '../../domain/ports/runtime-sandbox-store';

/**
 * Durable runtime-sandbox persistence. Keeps lifecycle metadata across
 * restarts so expired/failed sandboxes can always be identified and cleaned,
 * even when the process that created them is gone.
 */
export class PrismaRuntimeSandboxRepository implements RuntimeSandboxStore {
  constructor(private readonly db: PrismaClient) {}

  async save(sandbox: RuntimeSandbox): Promise<void> {
    await this.db.runtimeSandbox.upsert({
      where: { id: sandbox.id },
      create: toRow(sandbox),
      update: toUpdate(sandbox),
    });
  }

  async get(id: string): Promise<RuntimeSandbox | null> {
    const row = await this.db.runtimeSandbox.findUnique({ where: { id } });
    return row ? fromRow(row) : null;
  }

  async listByScan(scanId: string): Promise<readonly RuntimeSandbox[]> {
    const rows = await this.db.runtimeSandbox.findMany({
      where: { scanId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(fromRow);
  }

  async listByStatus(statuses: readonly RuntimeSandboxStatus[]): Promise<readonly RuntimeSandbox[]> {
    const rows = await this.db.runtimeSandbox.findMany({
      where: { status: { in: [...statuses] } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(fromRow);
  }

  async remove(id: string): Promise<void> {
    await this.db.runtimeSandbox.delete({ where: { id } }).catch(() => undefined);
  }
}

// -- mappers -----------------------------------------------------------------

type Row = Parameters<PrismaClient['runtimeSandbox']['create']>[0]['data'];

function toRow(sandbox: RuntimeSandbox): Row {
  return {
    id: sandbox.id,
    scanId: sandbox.scanId,
    status: sandbox.status as never,
    repositoryUrl: sandbox.repository.url ?? null,
    repositoryPath: sandbox.repository.path ?? null,
    name: sandbox.name ?? null,
    sandboxId: sandbox.sandboxId,
    imageId: sandbox.imageId,
    imageName: sandbox.imageName,
    networkId: sandbox.networkId,
    targetUrl: sandbox.targetUrl,
    internalHost: sandbox.internalHost,
    internalPort: sandbox.internalPort,
    exposedPort: sandbox.exposedPort,
    workspacePath: sandbox.workspacePath,
    expiresAt: sandbox.expiresAt ? new Date(sandbox.expiresAt) : null,
    destroyedAt: sandbox.destroyedAt ? new Date(sandbox.destroyedAt) : null,
    failureStage: sandbox.failureStage,
    failureReason: sandbox.failureReason,
    createdAt: new Date(sandbox.createdAt),
  };
}

function toUpdate(sandbox: RuntimeSandbox): Parameters<PrismaClient['runtimeSandbox']['update']>[0]['data'] {
  const { id: _id, createdAt: _, ...rest } = toRow(sandbox);
  return rest;
}

type RuntimeSandboxRow = {
  id: string;
  scanId: string;
  status: string;
  repositoryUrl: string | null;
  repositoryPath: string | null;
  name: string | null;
  sandboxId: string | null;
  imageId: string | null;
  imageName: string | null;
  networkId: string | null;
  targetUrl: string | null;
  internalHost: string | null;
  internalPort: number | null;
  exposedPort: number | null;
  workspacePath: string | null;
  expiresAt: Date | null;
  destroyedAt: Date | null;
  failureStage: string | null;
  failureReason: string | null;
  createdAt: Date;
};

function fromRow(row: RuntimeSandboxRow): RuntimeSandbox {
  return {
    id: row.id,
    scanId: row.scanId,
    status: row.status as RuntimeSandboxStatus,
    repository: {
      url: row.repositoryUrl ?? undefined,
      path: row.repositoryPath ?? undefined,
    },
    name: row.name,
    sandboxId: row.sandboxId,
    imageId: row.imageId,
    imageName: row.imageName,
    networkId: row.networkId,
    targetUrl: row.targetUrl,
    internalHost: row.internalHost,
    internalPort: row.internalPort,
    exposedPort: row.exposedPort,
    workspacePath: row.workspacePath,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    destroyedAt: row.destroyedAt?.toISOString() ?? null,
    failureStage: row.failureStage,
    failureReason: row.failureReason,
  };
}