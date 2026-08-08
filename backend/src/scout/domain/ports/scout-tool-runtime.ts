/**
 * The single execution seam for ALL Scout tooling. Tools never invoke
 * binaries or the network directly — they go through this port, which in
 * production routes CLI tools through the SandboxManager and HTTP probes
 * through a bounded fetcher. This is what makes the whole module headless-
 * testable (DirectToolRuntime) and sandbox-bound in production
 * (SandboxToolRuntime).
 */

export interface ToolExecRequest {
  /** argv only — never a shell string. e.g. ['nmap', '-Pn', 'host'] */
  readonly argv: readonly string[];
  readonly timeoutMs: number;
  /** Network policy for the sandboxed command. 'none' = no egress. */
  readonly network: 'none' | 'egress';
  readonly env?: Readonly<Record<string, string>>;
}

export interface ToolExecResult {
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  /** True when the binary does not exist (tool unavailable, not an error). */
  readonly toolMissing: boolean;
}

export interface HttpProbeOptions {
  readonly method?: 'GET' | 'HEAD' | 'POST';
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

/** A bounded HTTP probe result. `probe` never throws — failures are data. */
export interface HttpProbeResult {
  readonly url: string;
  readonly finalUrl: string;
  readonly ok: boolean;
  readonly statusCode: number | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly bodyBytes: number;
  readonly latencyMs: number;
  readonly error: string | null;
}

export interface ToolAvailability {
  readonly available: boolean;
  readonly version: string | null;
}

export interface ScoutToolRuntime {
  /** Run a CLI tool inside the sandbox context (or locally, headless). */
  exec(request: ToolExecRequest): Promise<ToolExecResult>;
  /** Bounded HTTP probe; returns an error result instead of throwing. */
  probe(url: string, options?: HttpProbeOptions): Promise<HttpProbeResult>;
  /** Whether a binary exists (nmap, …). Missing tools degrade, never fail. */
  toolAvailable(tool: string): Promise<ToolAvailability>;
}