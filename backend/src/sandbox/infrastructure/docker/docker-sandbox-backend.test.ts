import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import type { SandboxSpec } from '../../domain/models/sandbox';
import { DockerSandboxBackend } from './docker-sandbox-backend';
import { buildCreateCommand, buildImageCommand, type DockerRunner, type CliOutput } from './docker-cli';

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

  // --- Phase 6: runtime-sandbox hardening ---------------------------------

  it('runtime sandboxes: NO host mount, explicit env, pids limit, image CMD', () => {
    const args = buildCreateCommand(
      spec({
        type: 'runtime',
        network: { egress: 'internal', allowlist: [] },
        mountRepository: false,
        env: { PORT: '8000', NODE_ENV: 'production' },
        pidsLimit: 256,
        appCommand: [],
      }),
      'amass_rt'
    );
    const joined = args.join(' ');
    expect(joined).not.toContain('--volume'); // host filesystem never mounted
    expect(joined).not.toContain('--workdir'); // image WORKDIR governs image CMD
    expect(joined).toContain('--env PORT=8000');
    expect(joined).toContain('--env NODE_ENV=production');
    expect(joined).toContain('--pids-limit 256');
    expect(joined).not.toContain('tail -f /dev/null'); // image CMD runs the app
  });

  it('runtime sandboxes: appCommand override wins over image CMD', () => {
    const args = buildCreateCommand(
      spec({
        type: 'runtime',
        mountRepository: false,
        appCommand: ['python', 'server.py'],
      }),
      'amass_rt'
    );
    const joined = args.join(' ');
    expect(joined).toContain('python server.py');
    expect(joined).not.toContain('tail -f /dev/null');
  });

  it('localhost-only dynamic host port is bound to 127.0.0.1 (never 0.0.0.0)', () => {
    const args = buildCreateCommand(
      spec({
        type: 'runtime',
        mountRepository: false,
        hostPublishLocalhost: { containerPort: 8000 },
      }),
      'amass_rt'
    );
    expect(args.join(' ')).toContain('-p 127.0.0.1::8000');
    expect(args.join(' ')).not.toContain('0.0.0.0');
  });

  it('buildImageCommand is argv-only, labeled and points at the context', () => {
    const args = buildImageCommand({
      contextPath: '/tmp/ctx',
      dockerfilePath: 'Dockerfile',
      imageName: 'amass-rt-x',
      labels: { 'amass.manager': '1' },
    });
    expect(args[0]).toBe('build');
    expect(args).toContain('-t');
    expect(args).toContain('--label');
    expect(args).toContain('amass.manager=1'); // label passed as separate argv entry
    expect(args).toContain('-f');
    expect(args[args.length - 1]).toBe('/tmp/ctx');
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
    const runner: DockerRunner = async (args) => {
      calls.push([...args]);
      // network inspect reports not-found → ensureNetwork actually creates.
      if (args[0] === 'network' && args[1] === 'inspect') {
        return { stdout: '', stderr: 'No such network', exitCode: 1, timedOut: false };
      }
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
    };
    const backend = new DockerSandboxBackend(runner);
    await backend.create(
      spec({ type: 'runtime', network: { egress: 'internal', allowlist: [] } })
    );
    const create = calls.find((c) => c[0] === 'network' && c[1] === 'create');
    expect(create).toBeDefined();
    expect(create!.join(' ')).toContain('--internal');
    expect(create!.join(' ')).toContain('amass-net-scan_1');
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