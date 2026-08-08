import { spawn } from 'node:child_process';
import type {
  HttpProbeOptions,
  HttpProbeResult,
  ScoutToolRuntime,
  ToolAvailability,
  ToolExecRequest,
  ToolExecResult,
} from '../../domain/ports/scout-tool-runtime';
import type { SandboxManager } from '../../../sandbox/domain/ports/sandbox-manager';

/**
 * In-process, headless runtime: HTTP probes via Node fetch with a hard timeout
 * and body cap; CLI tools run as local subprocesses. This is the default for
 * dev/headless/CI. Probes and exec NEVER throw — failures are returned as
 * data so recon continues past any single tool.
 */
export class DirectToolRuntime implements ScoutToolRuntime {
  async exec(request: ToolExecRequest): Promise<ToolExecResult> {
    return execLocal(request);
  }

  async probe(url: string, options: HttpProbeOptions = {}): Promise<HttpProbeResult> {
    return probeFetch(url, options);
  }

  async toolAvailable(tool: string): Promise<ToolAvailability> {
    return await toolAvailable(tool);
  }
}

/**
 * Production runtime: HTTP probes run in-process (the target app is reachable
 * over the backend's network), but every CLI tool (nmap, …) is executed
 * *inside* the target application's sandbox via the SandboxManager, so recon
 * network activity stays within the sandbox boundary. `sandboxId` is the id of
 * the running-application sandbox the Scout is reconnoitring.
 */
export class SandboxToolRuntime implements ScoutToolRuntime {
  private readonly probes = new DirectToolRuntime();

  constructor(
    private readonly manager: SandboxManager,
    private readonly sandboxId: string,
  ) {}

  async exec(request: ToolExecRequest): Promise<ToolExecResult> {
    try {
      const result = await this.manager.execute(this.sandboxId, {
        argv: [...request.argv],
        timeoutMs: request.timeoutMs,
        envAllowlist: request.env ? Object.keys(request.env) : undefined,
        envOverrides: request.env,
        network: request.network === 'egress' ? 'egress' : 'none',
      });
      return {
        ok: !result.timedOut && result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        timedOut: result.timedOut,
        toolMissing: /not found|ENOENT/i.test(`${result.stderr ?? ''} ${result.exitCode}`),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        exitCode: null,
        stdout: '',
        stderr: message,
        timedOut: false,
        toolMissing: /ENOENT|not found/i.test(message),
      };
    }
  }

  async probe(url: string, options: HttpProbeOptions = {}): Promise<HttpProbeResult> {
    return this.probes.probe(url, options);
  }

  async toolAvailable(tool: string): Promise<ToolAvailability> {
    return this.probes.toolAvailable(tool);
  }
}

// ---------------------------------------------------------------------------
// Local implementations, no external state
// ---------------------------------------------------------------------------

export async function probeFetch(
  url: string,
  options: HttpProbeOptions = {},
): Promise<HttpProbeResult> {
  const method = options.method ?? 'GET';
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxBodyBytes = options.maxBodyBytes ?? 512 * 1024;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: { 'user-agent': 'amass-probe', ...options.headers },
      redirect: 'follow',
      signal: controller.signal,
    });
    const buf = Buffer.from(await response.arrayBuffer());
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => (headers[k] = v));
    return {
      url,
      finalUrl: response.url,
      ok: response.ok,
      statusCode: response.status,
      headers,
      body: buf.subarray(0, maxBodyBytes).toString('utf8'),
      bodyBytes: buf.byteLength,
      latencyMs: Date.now() - started,
      error: null,
    };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return {
      url,
      finalUrl: url,
      ok: false,
      statusCode: null,
      headers: {},
      body: '',
      bodyBytes: 0,
      latencyMs: Date.now() - started,
      error: aborted ? `timeout after ${timeoutMs}ms` : (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function execLocal(request: ToolExecRequest): Promise<ToolExecResult> {
  const [cmd, ...args] = request.argv;
  return new Promise<ToolExecResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const proc = spawn(cmd, args, { env: { ...process.env, ...request.env } });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, request.timeoutMs);

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > 2_000_000) proc.kill('SIGKILL');
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        toolMissing: /ENOENT/.test(stderr) || code === 127,
      });
    });
  });
}

export async function toolAvailable(tool: string): Promise<ToolAvailability> {
  const result = await execLocal({
    argv: process.platform === 'win32' ? ['where', tool] : ['sh', '-c', `command -v ${tool}`],
    timeoutMs: 3000,
    network: 'none',
  });
  return {
    available: result.ok && result.stdout.trim().length > 0,
    version: result.ok ? result.stdout.trim().split('\n')[0] || null : null,
  };
}