import type {
  ExecRequest,
  ExecResult,
  Sandbox,
  SandboxContainerInfo,
  SandboxPatch,
  SandboxSpec,
  SandboxStatus,
  SandboxType,
} from '../models/sandbox';
import type { HealthProbeResult } from '../value-objects/runtime-config';

/**
 * App-liveness probe executed from INSIDE a Docker network (isolated runtime
 * sandboxes have no host path — their internal IP is only routable from other
 * containers attached to the same `--internal` network). A throwaway probe
 * container is attached to `networkId` and checks the target address.
 */
export interface NetworkHealthProbeRequest {
  /** The sandbox's internal Docker network the probe container attaches to. */
  readonly networkId: string;
  /** Target address INSIDE that network (the sandbox container's IP). */
  readonly host: string;
  readonly port: number;
  /** HTTP path probed (any HTTP status counts as reachable). */
  readonly path: string;
  readonly timeoutMs: number;
  /** Probe image override (defaults to the config/backend default). */
  readonly image?: string;
}

export interface BuildImageRequest {
  /** Build context (host directory). */
  readonly contextPath: string;
  /** Dockerfile path relative to the context (default: Dockerfile). */
  readonly dockerfilePath?: string;
  readonly imageName: string;
  readonly timeoutMs?: number;
  /** Labels tied to the owning scan so sweeping can reclaim strays. */
  readonly labels?: Readonly<Record<string, string>>;
}

export interface BuildImageResult {
  readonly imageId: string;
  readonly imageName: string;
}

export interface CreateSandboxInput {
  readonly scanId: string;
  readonly type: SandboxType;
  readonly repositoryPath: string;
  readonly image: string;
  /** egress: 'none' for analysis; 'internal' or explicit for runtime. */
  readonly egress?: 'none' | 'internal' | 'egress';
  readonly egressAllowlist?: readonly string[];
  readonly memoryLimit?: string;
  readonly cpus?: number;
  // --- Runtime-sandbox extensions (Phase 6) -----------------------------
  /**
   * Runtime sandboxes must not mount the host repository: the image carries
   * the payload, so the host filesystem never enters the container.
   * Unset (default) = mount (analysis sandboxes).
   */
  readonly mountRepository?: boolean;
  /** Explicit container environment (service-provided; never host passthrough). */
  readonly env?: Readonly<Record<string, string>>;
  readonly pidsLimit?: number;
  /** undefined = keepalive; [] = image CMD; non-empty = explicit argv. */
  readonly appCommand?: readonly string[];
  /** Bind a dynamic host port on 127.0.0.1 only (never 0.0.0.0). */
  readonly hostPublishLocalhost?: { readonly containerPort: number };
}

export interface SandboxManagerOptions {
  /** The Docker-facing backend. The manager never talks to Docker itself. */
  readonly backend: SandboxBackend;
  /** Where sandbox records live (used by the reaper and lookup). */
  readonly store: SandboxStore;
  readonly defaultExecTimeoutMs?: number;
  readonly createTimeoutMs?: number;
}

export interface SandboxHealth {
  readonly ok: boolean;
  readonly status: SandboxStatus;
  /** When not ok — why (missing / not started / failed / destroyed …). */
  readonly reason?: string;
}

/**
 * The single, typed entry point every phase uses. Agents never touch
 * containers directly — they request operations here, and only the backend
 * (below) knows Docker.
 */
export interface SandboxManager {
  createSandbox(input: CreateSandboxInput): Promise<Sandbox>;
  /** Polls until the sandbox reports healthy. */
  waitUntilReady(id: string, timeoutMs?: number): Promise<Sandbox>;

  /** Read-only identity lookup: sandbox record or null (never throws). */
  getSandbox(id: string): Promise<Sandbox | null>;
  /** One-shot readiness probe (non-throwing, unlike waitUntilReady). */
  healthCheck(id: string, timeoutMs?: number): Promise<SandboxHealth>;

  /** Typed exec: argv-only, allowlisted env, hard timeout. */
  execute(id: string, request: ExecRequest): Promise<ExecResult>;

  /** Copy a file from the caller (host) into the sandbox at `destPath`. */
  copyFile(id: string, sourceHostPath: string, destPath: string): Promise<void>;

  /** Apply patches to the sandbox (never to the host) and restart it. */
  applyPatch(id: string, patches: readonly SandboxPatch[]): Promise<Sandbox>;

  restart(id: string): Promise<Sandbox>;

  /** Stream sandbox logs. */
  collectLogs(id: string): AsyncIterable<string>;

  /** Destroy container, network, volumes, temp files. Idempotent. */
  destroy(id: string): Promise<void>;

  /** Reaps orphaned resources (crashed processes). Run at startup + intervals. */
  sweepOrphans(): Promise<number>;

  // --- Runtime-sandbox primitives (Phase 6) ------------------------------
  /** Build a sandbox image from a host context (Docker backend only). */
  buildImage(request: BuildImageRequest): Promise<BuildImageResult>;
  /** Remove a sandbox image; safe no-op when already gone. */
  removeImage(imageIdOrName: string): Promise<void>;
  /** Ops view of a sandbox container (running state + network IP). */
  inspectRuntimeContainer(containerId: string): Promise<SandboxContainerInfo | null>;
  /** App-liveness probe from INSIDE the sandbox network (isolated runtime sandboxes). */
  probeNetworkHealth(request: NetworkHealthProbeRequest): Promise<HealthProbeResult>;
}

/**
 * The Docker-only seam. Implemented by the container adapter; deliberately
 * NOT exposed to agents — only the SandboxManager holds this.
 */
export interface SandboxBackend {
  create(spec: SandboxSpec): Promise<{
    containerId: string;
    networkId?: string;
    workspacePath?: string;
    ipAddress?: string;
    hostPort?: number;
  }>;
  start(id: string): Promise<void>;
  isReady(id: string): Promise<boolean>;
  execute(id: string, request: ExecRequest): Promise<ExecResult>;
  copyFile(id: string, sourceHostPath: string, destPath: string): Promise<void>;
  writeFile(id: string, destPath: string, content: string): Promise<void>;
  restart(id: string): Promise<void>;
  logs(id: string): AsyncIterable<string>;
  destroy(id: string): Promise<void>;
  sweep(): Promise<number>;
  /** Build a sandbox image. Docker-only; others throw SandboxRuntimeUnsupportedError. */
  buildImage(request: BuildImageRequest): Promise<BuildImageResult>;
  /** Remove a sandbox image; safe no-op when already gone. */
  removeImage(imageIdOrName: string): Promise<void>;
  /** Inspect a sandbox container (running status + network IP). */
  inspect(containerId: string): Promise<SandboxContainerInfo | null>;
  /** App-liveness probe from INSIDE a Docker network (runtime sandboxes). */
  probeNetworkHealth(request: NetworkHealthProbeRequest): Promise<HealthProbeResult>;
}

export interface SandboxStore {
  save(sandbox: Sandbox): Promise<void>;
  get(id: string): Promise<Sandbox | null>;
  list(): Promise<readonly Sandbox[]>;
  remove(id: string): Promise<void>;
}