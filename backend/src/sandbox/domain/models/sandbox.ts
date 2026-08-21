/**
 * Sandbox domain model — the shared vocabulary every phase (analyzer,
 * scanner, and future agents) uses to ask for an isolated, ephemeral,
 * per-scan environment. No Docker primitives leak here.
 */

export type SandboxType = 'analysis' | 'runtime';

export type SandboxStatus =
  | 'pending'
  | 'creating'
  | 'starting'
  | 'ready'
  | 'running'
  | 'executing'
  | 'restarting'
  | 'destroyed'
  | 'failed';

export interface SandboxNetworkPolicy {
  /**
   * 'none'     → loopback only (analysis sandboxes; no egress).
   * 'internal' → private network shared with sibling services, no host egress
   *              (runtime sandboxes where Sniper/into runs code).
   * 'egress'   → explicit, allowlisted egress (advisory fetches only).
   */
  egress: 'none' | 'internal' | 'egress';
  /** Allowlisted outbound hostnames/ports when egress === 'egress'. */
  readonly allowlist?: readonly string[];
}

export interface SandboxSpec {
  readonly scanId: string;
  readonly type: SandboxType;
  readonly image: string;
  /** Host path of the repository working tree bound read/write into the sandbox. */
  readonly repositoryPath: string;
  readonly network: SandboxNetworkPolicy;
  readonly memoryLimit?: string;
  readonly cpus?: number;
  /** Non-root uid the sandbox process runs as. */
  readonly uid?: number;
  // --- Runtime-sandbox extensions (Phase 6) -------------------------------
  /**
   * Bind the host repository path into the container. `true` for analysis
   * sandboxes; RUNTIME sandboxes must keep the host filesystem out of the
   * container (image carries the payload) — set to `false`.
   */
  readonly mountRepository?: boolean;
  /**
   * Explicit container environment (values are service-provided constants,
   * never a host-env passthrough). Only these keys reach the container.
   */
  readonly env?: Readonly<Record<string, string>>;
  /** Hard PID cgroup limit; never left unbounded. */
  readonly pidsLimit?: number;
  /**
   * Container command semantics:
   *  - undefined → keepalive `tail` (analysis sandboxes; image CMD unused),
   *  - []        → image default CMD (runtime sandboxes),
   *  - non-empty → explicit argv override.
   */
  readonly appCommand?: readonly string[];
  /** Publish a dynamic host port bound to 127.0.0.1 only (never 0.0.0.0). */
  readonly hostPublishLocalhost?: { readonly containerPort: number };
}

/** Ops-level state of a live sandbox container (Docker backend). */
export interface SandboxContainerInfo {
  readonly running: boolean;
  readonly status: string;
  readonly exitCode?: number;
  readonly ipAddress?: string;
  /** Allocated host port when published (localhost-bound). */
  readonly hostPort?: number;
}

/** Immutable descriptor of one live sandbox. */
export interface Sandbox {
  readonly id: string;
  readonly scanId: string;
  readonly type: SandboxType;
  readonly status: SandboxStatus;
  readonly image: string;
  readonly repositoryPath: string;
  readonly network: SandboxNetworkPolicy;
  readonly containerId?: string;
  readonly networkId?: string;
  /** Host-visible path of the repo tree (process backend) — container backends omit it. */
  readonly workspacePath?: string;
  /** Container IP on the sandbox network (runtime sandboxes). */
  readonly ipAddress?: string;
  /** Allocated localhost host port when the runtime sandbox publishes one. */
  readonly exposedPort?: number;
  // Runtime profile (Phase 6): keep the spec's container-level knobs.
  readonly mountRepository?: boolean;
  readonly env?: Readonly<Record<string, string>>;
  readonly pidsLimit?: number;
  readonly appCommand?: readonly string[];
  readonly hostPublishLocalhost?: { readonly containerPort: number };
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Typed, argv-only command request. Never a shell string. */
export interface ExecRequest {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly envAllowlist?: readonly string[];
  readonly envOverrides?: Readonly<Record<string, string>>;
  /** Per-call egress override, never more permissive than the sandbox policy. */
  readonly network?: 'none' | 'internal' | 'egress';
}

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}

/** Host-relative patch to apply (immutable host stays untouched). */
export interface SandboxPatch {
  readonly path: string;
  readonly content: string;
}