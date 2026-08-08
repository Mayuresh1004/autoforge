/**
 * The single execution seam for ALL Sniper tooling. Tools never invoke
 * binaries or the network directly — they go through this port. In
 * production the SandboxToolRuntime routes every command through the
 * SandboxManager (so exploits execute exclusively inside the sandbox); tests
 * inject a scripted in-memory runtime instead.
 */
export interface ToolExecRequest {
  /** argv only — never a shell string. */
  readonly argv: readonly string[];
  readonly timeoutMs: number;
  /**
   * Network policy for the sandboxed command. 'internal' (default) = the
   * private network shared with the target application's sandbox.
   */
  readonly network?: 'none' | 'internal' | 'egress';
  readonly envAllowlist?: readonly string[];
  readonly envOverrides?: Readonly<Record<string, string>>;
}

export interface ToolExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}

export interface ToolRuntime {
  execute(request: ToolExecRequest): Promise<ToolExecResult>;
}