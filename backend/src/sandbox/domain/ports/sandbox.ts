/**
 * Sandbox ports — the single boundary through which every operation that
 * runs on (untrusted) repository code or clones goes: git clone, analyzers
 * that spawn processes, and all scanner CLIs.
 *
 * Implementations are interchangeable (process-level now, container/gVisor
 * later) without touching consumers.
 */

export type SandboxNetwork = 'none' | 'net';

export interface SandboxRunOptions {
  /** Full argv for the child (no shell anywhere). */
  readonly argv: readonly string[];
  /** Working directory of the child. */
  readonly cwd: string;
  /** Hard timeout; the child is SIGTERM-killed after this. */
  readonly timeoutMs: number;
  /** Maximum accumulated stdout/stderr bytes. */
  readonly maxBufferBytes?: number;
  /**
   * Base env keys inherited from `process.env`. Anything else — including
   * secrets, tokens, and project config — is never passed to the child.
   * Defaults to a minimal safe set (`PATH`, `HOME`, `TMPDIR`, `LANG`).
   */
  readonly envAllowlist?: readonly string[];
  /** Explicit safe env values (e.g. `GIT_TERMINAL_PROMPT=0`). */
  readonly envOverrides?: Readonly<Record<string, string>>;
  /** Network egress policy for the child. */
  readonly network: SandboxNetwork;
}

export interface SandboxOutput {
  readonly stdout: string;
  readonly stderr: string;
  /** Exit code, or null when the process was killed/timed out. */
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}

export interface SandboxWorkspace {
  readonly dir: string;
  /** Recursively removes the workspace. Safe to call multiple times. */
  dispose(): Promise<void>;
}

export interface SandboxRuntime {
  run(options: SandboxRunOptions): Promise<SandboxOutput>;
  /** Creates an isolated, throwaway working directory. */
  createWorkspace(label?: string): Promise<SandboxWorkspace>;
}