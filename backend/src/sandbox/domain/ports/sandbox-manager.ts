import type {
  ExecRequest,
  ExecResult,
  Sandbox,
  SandboxPatch,
  SandboxSpec,
  SandboxStatus,
  SandboxType,
} from '../models/sandbox';

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
}

/**
 * The Docker-only seam. Implemented by the container adapter; deliberately
 * NOT exposed to agents — only the SandboxManager holds this.
 */
export interface SandboxBackend {
  create(spec: SandboxSpec): Promise<{ containerId: string; networkId?: string; workspacePath?: string }>;
  start(id: string): Promise<void>;
  isReady(id: string): Promise<boolean>;
  execute(id: string, request: ExecRequest): Promise<ExecResult>;
  copyFile(id: string, sourceHostPath: string, destPath: string): Promise<void>;
  writeFile(id: string, destPath: string, content: string): Promise<void>;
  restart(id: string): Promise<void>;
  logs(id: string): AsyncIterable<string>;
  destroy(id: string): Promise<void>;
  sweep(): Promise<number>;
}

export interface SandboxStore {
  save(sandbox: Sandbox): Promise<void>;
  get(id: string): Promise<Sandbox | null>;
  list(): Promise<readonly Sandbox[]>;
  remove(id: string): Promise<void>;
}