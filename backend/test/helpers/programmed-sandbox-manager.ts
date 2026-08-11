import type {
  Sandbox,
  SandboxContainerInfo,
  SandboxHealth,
  SandboxPatch,
  SandboxStatus,
} from '../../src/sandbox/domain/models/sandbox';
import type {
  BuildImageRequest,
  BuildImageResult,
  CreateSandboxInput,
  NetworkHealthProbeRequest,
  SandboxManager,
} from '../../src/sandbox/domain/ports/sandbox-manager';
import type { HealthProbeResult } from '../../src/sandbox/domain/value-objects/runtime-config';
import type { ExecRequest, ExecResult } from '../../src/sandbox/domain/models/sandbox';

/**
 * Fully-programmable SandboxManager for runtime-lifecycle unit tests.
 * Records every call; lets tests script build results, inspect results and
 * create failures — nothing Docker-specific exists here.
 */
export class ProgrammedSandboxManager implements SandboxManager {
  sandboxes = new Map<string, Sandbox>();
  createCalls: CreateSandboxInput[] = [];
  buildCalls: BuildImageRequest[] = [];
  removedImages: string[] = [];
  destroyed: string[] = [];
  execCalls: Array<{ sandboxId: string; request: ExecRequest }> = [];
  inspectOverrides = new Map<string, SandboxContainerInfo | null>();
  failCreate = false;
  failBuild = false;
  createResultOverride: Partial<Sandbox> | null = null;
  execResult: ExecResult = { stdout: '', stderr: '', exitCode: 0, timedOut: false };
  /** Scripted in-network probe results (default: healthy). */
  networkProbeResult: HealthProbeResult = { reachable: true, latencyMs: 3, statusCode: 200 };
  networkProbeCalls: NetworkHealthProbeRequest[] = [];
  failNetworkProbe = false;

  async createSandbox(input: CreateSandboxInput): Promise<Sandbox> {
    this.createCalls.push(input);
    if (this.failCreate) throw new Error('create sandbox failed (programmed)');
    const ip = '172.19.0.10';
    const sandbox: Sandbox = {
      id: `sbx_${input.scanId}_prog`,
      scanId: input.scanId,
      type: input.type,
      status: 'ready',
      image: input.image,
      repositoryPath: input.repositoryPath,
      network: { egress: input.egress ?? 'none', allowlist: [] },
      containerId: `ctr_${input.scanId}`,
      networkId: `amass-net-${input.scanId}`,
      ipAddress: ip,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...this.createError,
    };
    this.sandboxes.set(sandbox.id, sandbox);
    return sandbox;
  }

  async waitUntilReady(id: string): Promise<Sandbox> {
    const sb = this.sandboxes.get(id);
    if (!sb) throw new Error(`sandbox ${id} not found`);
    return sb;
  }

  async getSandbox(id: string): Promise<Sandbox | null> {
    return this.sandboxes.get(id) ?? null;
  }

  async healthCheck(id: string): Promise<SandboxHealth> {
    const sb = this.sandboxes.get(id);
    if (!sb) return { ok: false, status: 'pending', reason: 'missing' };
    return { ok: true, status: 'ready' };
  }

  async execute(id: string, request: ExecRequest): Promise<ExecResult> {
    this.execCalls.push({ sandboxId: id, request });
    return this.execResult;
  }

  async copyFile(): Promise<void> {}
  async applyPatch(): Promise<Sandbox> {
    throw new Error('not implemented in fake');
  }
  async restart(): Promise<Sandbox> {
    throw new Error('not implemented in fake');
  }
  async *collectLogs(_id: string): AsyncIterable<string> {
    return;
  }

  async destroy(id: string): Promise<void> {
    this.destroyed.push(id);
    this.sandboxes.delete(id);
  }

  async sweepOrphans(): Promise<number> {
    return 0;
  }

  async buildImage(request: BuildImageRequest): Promise<BuildImageResult> {
    this.buildCalls.push(request);
    if (this.failBuild) throw new Error('build image failed (programmed)');
    return { imageId: `sha256:${request.imageName}`, imageName: request.imageName };
  }

  async removeImage(imageIdOrName: string): Promise<void> {
    this.removedImages.push(imageIdOrName);
  }

  async inspectRuntimeContainer(containerId: string): Promise<SandboxContainerInfo | null> {
    const overridden = this.inspectOverrides.get(containerId);
    if (overridden !== undefined) return overridden;
    return { running: true, status: 'running', ipAddress: '172.19.0.10' };
  }

  async probeNetworkHealth(request: NetworkHealthProbeRequest): Promise<HealthProbeResult> {
    this.networkProbeCalls.push(request);
    if (this.failNetworkProbe) {
      return { reachable: false, latencyMs: 1, detail: 'network probe failed (fake)' };
    }
    return this.networkProbeResult;
  }
}

export type { SandboxStatus, SandboxPatch };