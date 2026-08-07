import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../../config/logger';
import type {
  SandboxNetwork,
  SandboxOutput,
  SandboxRunOptions,
  SandboxRuntime,
  SandboxWorkspace,
} from '../domain/ports/sandbox';

interface ExecFileError extends Error {
  code?: number | null;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
}

/** Minimal env allowlist used when a command does not specify one. */
export const SAFE_DEFAULT_ENV = ['PATH', 'HOME', 'TMPDIR', 'LANG'] as const;

/**
 * Builds the child environment from an explicit allowlist of `process.env`
 * keys plus safe overrides. Anything not allowlisted — secrets, tokens,
 * project config — is never passed to the child process.
 */
export function buildEnv(
  allowlist: readonly string[] = SAFE_DEFAULT_ENV,
  overrides?: Readonly<Record<string, string>>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowlist) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Pure decision: wraps argv with `unshare` network namespacing when network
 * egress must be blocked and the host supports unprivileged user/net
 * namespaces. Kept pure so behavior is unit-testable on any host.
 */
export function withNetIsolation(
  argv: readonly string[],
  supported: boolean,
  network: SandboxNetwork
): readonly string[] {
  if (network !== 'none' || !supported) return [...argv];
  return ['unshare', '--user', '--map-root-user', '--net', '--', ...argv];
}

/**
 * Process-level sandbox: runs children with sanitized env, no shell,
 * hard timeouts, bounded buffers, and — when the host supports it — a
 * private network namespace (`unshare --net`) so children have no egress.
 * Also manages throwaway per-operation workspaces.
 */
export class ProcessSandboxRuntime implements SandboxRuntime {
  private readonly tmpRoot: string;
  private netIsolationSupported: boolean | null = null;

  constructor(options: { tmpRoot?: string } = {}) {
    this.tmpRoot = options.tmpRoot ?? os.tmpdir();
  }

  async run(options: SandboxRunOptions): Promise<SandboxOutput> {
    const env = buildEnv(options.envAllowlist, options.envOverrides);
    const argv = withNetIsolation(
      options.argv,
      await this.supportsNetIsolation(),
      options.network
    );
    const [file, ...args] = argv;

    try {
      const { stdout, stderr } = await promisifiedExecFile(file, args, {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: options.maxBufferBytes ?? 32 * 1024 * 1024,
        env,
      });
      return { stdout, stderr, exitCode: 0, timedOut: false };
    } catch (error) {
      const err = error as ExecFileError;
      return {
        stdout: (err.stdout ?? '') as string,
        stderr: (err.stderr ?? '') as string,
        exitCode: err.code ?? null,
        timedOut: err.killed === true && err.signal === 'SIGTERM',
      };
    }
  }

  async createWorkspace(label = 'sandbox'): Promise<SandboxWorkspace> {
    const dir = await fs.mkdtemp(path.join(this.tmpRoot, `amass-${label}-`));
    return {
      dir,
      dispose: async () => {
        await fs.rm(dir, { recursive: true, force: true });
      },
    };
  }

  /**
   * Feature-detects unprivileged network namespaces once, caching the
   * result. When unsupported (e.g. Docker disables userns), network blocking
   * degrades to a logged best-effort (commands still run with offline flags
   * where applicable) instead of failing the scan.
   */
  private async supportsNetIsolation(): Promise<boolean> {
    if (this.netIsolationSupported !== null) return this.netIsolationSupported;
    let supported = false;
    try {
      await promisifiedExecFile('unshare', ['--user', '--map-root-user', '--net', '--', 'true'], {
        cwd: os.tmpdir(),
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
        env: buildEnv(['PATH']),
      });
      supported = true;
    } catch {
      supported = false;
    }
    this.netIsolationSupported = supported;
    if (!supported) {
      logger.warn(
        'sandbox.net-isolation:unavailable — unshare/user namespaces not supported on this host; network egress blocking is best-effort'
      );
    }
    return supported;
  }
}

function promisifiedExecFile(
  file: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error as ExecFileError);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}