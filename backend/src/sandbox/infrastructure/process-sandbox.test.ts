import { describe, it, expect, vi, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import {
  ProcessSandboxRuntime,
  buildEnv,
  withNetIsolation,
} from './process-sandbox';
import { ProcessScannerExecutor } from '../../static-scanner/infrastructure/scanning/executor/process-scanner-executor';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildEnv (env sanitization)', () => {
  it('never passes unallowlisted vars — secrets are stripped', () => {
    vi.stubEnv('AMASS_SECRET_TOKEN', 'super-secret');
    vi.stubEnv('DATABASE_URL', 'postgres://user:pass@host/db');

    const env = buildEnv(['PATH']);

    expect(env.AMASS_SECRET_TOKEN).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.PATH).toBeDefined();
  });

  it('merges safe overrides and allowlisted keys', () => {
    const env = buildEnv(['PATH'], { GIT_TERMINAL_PROMPT: '0' });
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.PATH).toBeDefined();
  });

  it('defaults to the minimal safe allowlist', () => {
    vi.stubEnv('AMASS_SECRET_TOKEN', 'super-secret');
    const env = buildEnv();
    expect(env.AMASS_SECRET_TOKEN).toBeUndefined();
    expect(env.PATH).toBeDefined();
  });
});

describe('withNetIsolation (pure decision)', () => {
  it('wraps argv with unshare when egress must be blocked and namespaces exist', () => {
    const argv = withNetIsolation(['semgrep', 'scan', '/repo'], true, 'none');
    expect(argv.slice(0, 5)).toEqual(['unshare', '--user', '--map-root-user', '--net', '--']);
    expect(argv.slice(5)).toEqual(['semgrep', 'scan', '/repo']);
  });

  it('leaves argv untouched when network is allowed or namespaces are unsupported', () => {
    expect(withNetIsolation(['npm', 'audit'], true, 'net')).toEqual(['npm', 'audit']);
    expect(withNetIsolation(['git', 'clone', 'x'], false, 'none')).toEqual([
      'git',
      'clone',
      'x',
    ]);
  });
});

describe('ProcessSandboxRuntime', () => {
  const runtime = new ProcessSandboxRuntime();

  it('runs a child with only the allowlisted env visible', async () => {
    vi.stubEnv('AMASS_SECRET_TOKEN', 'super-secret');
    const out = await runtime.run({
      argv: [
        'node',
        '-e',
        'console.log(JSON.stringify({ secret: !!process.env.AMASS_SECRET_TOKEN, path: !!process.env.PATH, gp: process.env.GIT_TERMINAL_PROMPT ?? null }))',
      ],
      cwd: os.tmpdir(),
      timeoutMs: 5_000,
      envAllowlist: ['PATH'],
      envOverrides: { GIT_TERMINAL_PROMPT: '0' },
      network: 'none',
    });

    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual({ secret: false, path: true, gp: '0' });
  });

  it('kills long-running children after the timeout (timedOut=true, never hangs)', async () => {
    const out = await runtime.run({
      argv: ['node', '-e', 'setTimeout(() => 0, 30_000)'],
      cwd: os.tmpdir(),
      timeoutMs: 150,
      network: 'none',
    });
    expect(out.timedOut).toBe(true);
    expect(out.exitCode).toBeNull();
  });

  it('reports non-zero exit codes', async () => {
    const out = await runtime.run({
      argv: ['node', '-e', 'process.exit(3)'],
      cwd: os.tmpdir(),
      timeoutMs: 5_000,
      network: 'none',
    });
    expect(out.exitCode).toBe(3);
    expect(out.timedOut).toBe(false);
  });

  it('creates and disposes throwaway workspaces', async () => {
    const workspace = await runtime.createWorkspace('sbox-test');
    await expect(fs.access(workspace.dir)).resolves.toBeUndefined();

    await workspace.dispose();
    await expect(fs.access(workspace.dir)).rejects.toThrow();

    // Dispose is idempotent.
    await expect(workspace.dispose()).resolves.toBeUndefined();
  });
});

describe('ProcessScannerExecutor (sandboxed scanner CLI execution)', () => {
  const executor = new ProcessScannerExecutor();

  it('executes a command with an allowlisted env and no secrets', async () => {
    vi.stubEnv('AMASS_SECRET_TOKEN', 'super-secret');
    const out = await executor.execute({
      argv: [
        'node',
        '-e',
        'console.log(JSON.stringify({ secret: !!process.env.AMASS_SECRET_TOKEN, path: !!process.env.PATH }))',
      ],
      cwd: os.tmpdir(),
      timeoutMs: 5_000,
    });
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual({ secret: false, path: true });
  });

  it('passes through exit codes and timeouts', async () => {
    const failed = await executor.execute({
      argv: ['node', '-e', 'process.exit(2)'],
      cwd: os.tmpdir(),
      timeoutMs: 5_000,
    });
    expect(failed.exitCode).toBe(2);

    const slow = await executor.execute({
      argv: ['node', '-e', 'setTimeout(() => 0, 30_000)'],
      cwd: os.tmpdir(),
      timeoutMs: 150,
    });
    expect(slow.timedOut).toBe(true);
  });
});