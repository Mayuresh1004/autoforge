import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import type { SandboxSpec } from '../../domain/models/sandbox';
import { DockerSandboxBackend } from './docker-sandbox-backend';
import { buildCreateCommand, type DockerRunner, type CliOutput } from './docker-cli';

function fakeRunner(record: string[][]): DockerRunner {
  return async (args) => {
    record.push([...args]);
    return { stdout: '', stderr: '', exitCode: 0, timedOut: false } as CliOutput;
  };
}

function spec(overrides: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    scanId: 'scan_1',
    type: 'analysis',
    image: 'amass/analysis:latest',
    repositoryPath: '/tmp/ws/repo',
    network: { egress: 'none', allowlist: [] },
    uid: 10001,
    ...overrides,
  };
}

describe('buildCreateCommand (pure)', () => {
  it('hardens a detached container and binds the repo read/write at the mount', () => {
    const args = buildCreateCommand(spec(), 'amass_demo').join(' ');
    expect(args).toContain('run -d');
    expect(args).toContain('--name amass_demo');
    expect(args).toContain('--network none'); // analysis: no egress
    expect(args).toContain('--read-only');
    expect(args).toContain('--cap-drop ALL');
    expect(args).toContain('--security-opt no-new-privileges:true');
    expect(args).toContain('--user 10001');
    expect(args).toContain('/tmp/ws/repo:/workspace');
    expect(args).toContain('amass/analysis:latest');
  });

  it('uses an internal network for runtime sandboxes', () => {
    const args = buildCreateCommand(
      spec({ type: 'runtime', network: { egress: 'internal', allowlist: [] } }),
      'amass_r'
    );
    expect(args.join(' ')).toContain('--network amass-net-scan_1');
  });
});

describe('DockerSandboxBackend (fake docker runner)', () => {
  it('creates the container and records the hardened commands', async () => {
    const calls: string[][] = [];
    const backend = new DockerSandboxBackend(fakeRunner(calls));

    const { containerId } = await backend.create(spec());

    expect(containerId).toEqual(expect.stringMatching(/^amass_scan_1_/));
    const create = calls[0];
    expect(create.join(' ')).toContain('--network none');
    expect(create.join(' ')).toContain('--label amass.manager=1');
  });

  it('creates an internal network before a runtime container', async () => {
    const calls: string[][] = [];
    const backend = new DockerSandboxBackend(fakeRunner(calls));
    await backend.create(
      spec({ type: 'runtime', network: { egress: 'internal', allowlist: [] } })
    );
    expect(calls[0][1]).toBe('create');
    expect(calls[0].join(' ')).toContain('--internal');
  });

  it('isReady parses the inspect result', async () => {
    const calls: string[][] = [];
    const runner: DockerRunner = async (args) => {
      calls.push([...args]);
      if (args[0] === 'inspect') return { stdout: 'true\n', stderr: '', exitCode: 0, timedOut: false };
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
    };
    const backend = new DockerSandboxBackend(runner);
    await backend.create(spec());
    expect(await backend.isReady('ct')).toBe(true);
  });

  it('builds an exec with workdir + allowlisted env', async () => {
    const calls: string[][] = [];
    const backend = new DockerSandboxBackend(fakeRunner(calls));
    const exec = await backend.execute('ct', {
      argv: ['bandit', '-r', '/'],
      cwd: 'src',
      timeoutMs: 3_000,
      envAllowlist: ['PATH'],
    });
    expect(exec.exitCode).toBe(0);
    const call = calls[0];
    expect(call[0]).toBe('exec');
    expect(call).toContain('--workdir');
    expect(call).toContain('bandit');
  });

  it('writeFile copies a temp file into the container then cleans it up', async () => {
    const calls: string[][] = [];
    const backend = new DockerSandboxBackend(fakeRunner(calls));
    await backend.writeFile('ct', 'src/a.ts', 'export const x = 1;');
    const cp = calls.find((c) => c[0] === 'cp');
    expect(cp).toBeDefined();
    const tmpSource = cp![1];
    await expect(fs.access(tmpSource)).rejects.toThrow(); // temp file removed
    expect(cp![2]).toBe('ct:/workspace/src/a.ts');
  });

  it('destroy removes the container and its network', async () => {
    const calls: string[][] = [];
    const backend = new DockerSandboxBackend(fakeRunner(calls));
    const { containerId, networkId } = await backend.create(
      spec({ type: 'runtime', network: { egress: 'internal', allowlist: [] } })
    );
    calls.length = 0;
    await backend.destroy(containerId);
    expect(calls).toContainEqual(['rm', '-f', containerId]);
    if (networkId) expect(calls).toContainEqual(['network', 'rm', networkId]);
  });
});