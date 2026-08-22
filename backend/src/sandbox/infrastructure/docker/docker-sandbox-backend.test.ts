import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { SandboxSpec } from '../../domain/models/sandbox';
import { DockerSandboxBackend } from './docker-sandbox-backend';
import { SandboxImageBuildError } from '../../domain/errors/sandbox-runtime.errors';
import { buildCreateCommand, buildImageCommand, buildProbeCommand, type DockerRunner, type CliOutput } from './docker-cli';

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

  it('refuses to bind-mount a non-absolute repositoryPath (no arbitrary host mounts)', () => {
    expect(() => buildCreateCommand(spec({ repositoryPath: 'in-sandbox' }), 'amass_demo')).toThrow(
      /non-absolute repositoryPath/
    );
    expect(() => buildCreateCommand(spec({ repositoryPath: '../etc' }), 'amass_demo')).toThrow(
      /non-absolute repositoryPath/
    );
  });

  it('buildProbeCommand: hardened throwaway container attached to the internal network', () => {
    const args = buildProbeCommand({
      image: 'probe:img',
      networkId: 'amass-net-scan_1',
      host: '172.19.0.2',
      port: 8080,
      path: '/',
      timeoutMs: 5_000,
    });
    const joined = args.join(' ');
    expect(args[0]).toBe('run');
    expect(joined).toContain('--rm'); // never leaks after exit
    expect(joined).toContain('--label amass.manager=1'); // sweep reclaims crash leftovers
    expect(joined).toContain('--network amass-net-scan_1'); // sandbox's own internal net
    expect(joined).toContain('--cap-drop ALL');
    expect(joined).toContain('--security-opt no-new-privileges:true');
    expect(joined).toContain('--read-only');
    expect(joined).toContain('--tmpfs /tmp:rw,exec,nodev,nosuid');
    expect(joined).not.toContain('0.0.0.0'); // no published ports
    expect(joined).not.toContain('--publish');
    expect(joined).not.toContain('--volume'); // no host mounts
    expect(joined).toContain('probe:img node -e');
    // The probe arguments are passed verbatim (argv-only, no shell).
    expect(args.slice(-4)).toEqual(['172.19.0.2', '8080', '/', '5000']);
    const script = args[args.indexOf('-e') + 1];
    expect(script).toContain('net.connect');
    expect(script).toContain('HEALTH_OK');
    expect(script).toContain('HEALTH_ERR');
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

  it('probeNetworkHealth returns HEALTH_OK + status when the app answers', async () => {
    const calls: string[][] = [];
    const runner: DockerRunner = async (args) => {
      calls.push([...args]);
      return { stdout: 'HEALTH_OK 200\n', stderr: '', exitCode: 0, timedOut: false };
    };
    const backend = new DockerSandboxBackend(runner);
    const result = await backend.probeNetworkHealth({
      networkId: 'amass-net-scan_1',
      host: '172.19.0.2',
      port: 8080,
      path: '/',
      timeoutMs: 5_000,
    });
    expect(result).toMatchObject({ reachable: true, statusCode: 200 });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    const run = calls[0];
    expect(run[0]).toBe('run');
    expect(run.join(' ')).toContain('--network amass-net-scan_1');
    expect(run.slice(-4)).toEqual(['172.19.0.2', '8080', '/', '5000']);
  });

  it('probeNetworkHealth reports HEALTH_ERR detail as unreachable', async () => {
    const runner: DockerRunner = async () => ({
      stdout: 'HEALTH_ERR tcp connect ECONNREFUSED',
      stderr: '',
      exitCode: 1,
      timedOut: false,
    });
    const backend = new DockerSandboxBackend(runner);
    const result = await backend.probeNetworkHealth({
      networkId: 'amass-net-scan_1',
      host: '172.19.0.2',
      port: 8080,
      path: '/',
      timeoutMs: 5_000,
    });
    expect(result.reachable).toBe(false);
    expect(result.detail).toContain('ECONNREFUSED');
  });

  it('probeNetworkHealth bounds runaway probe containers with the docker timeout', async () => {
    const runner: DockerRunner = async () => ({
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: true,
    });
    const backend = new DockerSandboxBackend(runner);
    const result = await backend.probeNetworkHealth({
      networkId: 'amass-net-scan_1',
      host: '172.19.0.2',
      port: 8080,
      path: '/',
      timeoutMs: 5_000,
    });
    expect(result.reachable).toBe(false);
    expect(result.detail).toMatch(/timed out/);
  });

  it('probeNetworkHealth surfaces docker-level failures (e.g. probe image missing)', async () => {
    const runner: DockerRunner = async () => ({
      stdout: '',
      stderr: 'Unable to find image \'probe:img\' locally',
      exitCode: 125,
      timedOut: false,
    });
    const backend = new DockerSandboxBackend(runner);
    const result = await backend.probeNetworkHealth({
      networkId: 'amass-net-scan_1',
      host: '172.19.0.2',
      port: 8080,
      path: '/',
      timeoutMs: 5_000,
      image: 'probe:img',
    });
    expect(result.reachable).toBe(false);
    expect(result.detail).toContain('Unable to find image');
  });

  it('buildImage surfaces command, exit code, and complete stderr/stdout on build failure', async () => {
    const runner: DockerRunner = async () => ({
      stdout: 'Step 1/3 : FROM node:22-alpine\nStep 2/3 : COPY . .\n',
      stderr: 'sh: cd: can\'t cd to frontend: No such file or directory\nnpm ERR! code 2',
      exitCode: 2,
      timedOut: false,
    });
    const backend = new DockerSandboxBackend(runner);
    const err = await backend
      .buildImage({ contextPath: '/tmp', imageName: 'fail-test' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SandboxImageBuildError);
    const buildErr = err as any;
    expect(buildErr.message).toContain('failed with exit code 2');
    expect(buildErr.buildOutput).toContain("can't cd to frontend");
    expect(buildErr.buildOutput).toContain('Step 1/3');
  });

  it('ensureSecurityToolsImage resolves Dockerfile.security-tools when CWD is backend directory', async () => {
    const calls: string[][] = [];
    const runner: DockerRunner = async (args) => {
      calls.push([...args]);
      if (args[0] === 'image' && args[1] === 'inspect') {
        // First inspect fails (image missing), second inspect succeeds (image built)
        const inspectCount = calls.filter((c) => c[0] === 'image' && c[1] === 'inspect').length;
        if (inspectCount === 1) return { stdout: '', stderr: 'No such image', exitCode: 1, timedOut: false };
        return { stdout: '[]', stderr: '', exitCode: 0, timedOut: false };
      }
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
    };
    const backend = new DockerSandboxBackend(runner);
    const result = await backend.executeToolInNetwork({
      networkId: 'amass-net-scan_1',
      argv: ['sqlmap', '--url', 'http://172.19.0.2:8000/search?q=1', '--batch'],
      timeoutMs: 30_000,
    });
    expect(result.exitCode).toBe(0);
    const buildCall = calls.find((c) => c[0] === 'build');
    expect(buildCall).toBeDefined();
    expect(buildCall!.join(' ')).toContain('Dockerfile.security-tools');
  });
});

/**
 * Fake docker that answers the image-user probe and the ownership helper like
 * a real daemon: the image's own USER reports uid/gid `1001:1001`, and the
 * root helper container chowns successfully.
 */
function programmedRunner(record: string[][]): DockerRunner {
  return async (args) => {
    record.push([...args]);
    if (args[0] === 'run' && args.includes('-c') && args.includes('id -u; id -g')) {
      return { stdout: '1001\n1001\n', stderr: '', exitCode: 0, timedOut: false };
    }
    if (args[0] === 'run' && args.includes('chown')) {
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
    }
    return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
  };
}

describe('DockerSandboxBackend — analysis workspace provisioning', () => {
  const roots: string[] = [];
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), 'amass-test-ws-'));
    roots.push(workspaceRoot);
  });

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('provisions a real host workspace for the synthetic repositoryPath and mounts it at /workspace', async () => {
    const calls: string[][] = [];
    const backend = new DockerSandboxBackend(programmedRunner(calls), { workspaceRoot });

    const { containerId, workspacePath } = await backend.create(
      spec({ repositoryPath: 'in-sandbox' })
    );

    // A REAL host workspace was provisioned under the backend's workspace root.
    expect(workspacePath).toBeDefined();
    expect(workspacePath!.startsWith(workspaceRoot + path.sep)).toBe(true);
    expect(workspacePath).not.toBe('/workspace');
    await expect(fs.access(workspacePath!)).resolves.toBeUndefined();

    // The generated docker command mounts <host-workspace>:/workspace — never
    // the synthetic marker.
    const create = calls.find((c) => c[0] === 'run' && c.includes('--name'))!;
    expect(create).toBeDefined();
    expect(create.join(' ')).toContain(`${workspacePath}:/workspace`);
    expect(create.join(' ')).not.toContain('in-sandbox:/workspace');
    expect(create.join(' ')).toContain('--workdir /workspace');
    expect(create.join(' ')).toContain(`--name ${containerId}`);
  });

  it('resolves the non-root container user from the image and sets compatible ownership', async () => {
    const calls: string[][] = [];
    const backend = new DockerSandboxBackend(programmedRunner(calls), { workspaceRoot });

    await backend.create(spec({ repositoryPath: 'in-sandbox' }));

    // The image-user probe ran as the image's own USER and read uid/gid.
    const probe = calls.find(
      (c) => c[0] === 'run' && c.includes('-c') && c.includes('id -u; id -g')
    );
    expect(probe).toBeDefined();
    expect(probe!.join(' ')).toContain('amass/analysis:latest');

    // Ownership is applied via the image itself (root helper, same image),
    // chowning the workspace to the image user's group — no chmod 777.
    const chownCall = calls.find((c) => c[0] === 'run' && c.some((arg) => arg.includes('chown')));
    expect(chownCall).toBeDefined();
    expect(chownCall!.join(' ')).toContain('chown');
    // Owner = the host backend process (it analyzes the tree); group = the
    // image user's group (the non-root container user writes through it).
    expect(chownCall!.join(' ')).toMatch(/chown \d+:1001 \/ws/);
    expect(chownCall!.join(' ')).toContain('chmod 770 /ws');
    expect(chownCall!.join(' ')).not.toContain('777');
    expect(chownCall!.join(' ')).toContain('--user 0:0'); // root helper only
    expect(chownCall!.join(' ')).toContain('amass/analysis:latest');
  });

  it('keeps the container non-root: no --user 0, and no --user when the image user governs', async () => {
    const calls: string[][] = [];
    const backend = new DockerSandboxBackend(programmedRunner(calls), { workspaceRoot });

    await backend.create(spec({ repositoryPath: 'in-sandbox' }));
    const create = calls.find((c) => c[0] === 'run' && c.includes('--name'))!;
    expect(create.join(' ')).not.toContain('--user 0');
    expect(create.join(' ')).toContain('--user 10001'); // explicit spec uid stays

    // Without an explicit uid the container runs as the image's amass user.
    calls.length = 0;
    const backend2 = new DockerSandboxBackend(programmedRunner(calls), { workspaceRoot });
    await backend2.create(spec({ repositoryPath: 'in-sandbox', uid: undefined }));
    const create2 = calls.find((c) => c[0] === 'run' && c.includes('--name'))!;
    expect(create2.join(' ')).not.toContain('--user');
  });

  it('maps the host workspace workdir back to /workspace for manager.execute', async () => {
    const calls: string[][] = [];
    const backend = new DockerSandboxBackend(programmedRunner(calls), { workspaceRoot });
    const { containerId, workspacePath } = await backend.create(
      spec({ repositoryPath: 'in-sandbox' })
    );

    calls.length = 0;
    await backend.execute(containerId, {
      argv: ['git', 'clone', '--depth', '1', 'https://example.test/repo.git', '.'],
      cwd: workspacePath!, // orchestrator hands the HOST path
      timeoutMs: 3_000,
      envAllowlist: [],
    });

    const exec = calls.find((c) => c[0] === 'exec')!;
    expect(exec).toBeDefined();
    expect(exec.join(' ')).toContain('--workdir /workspace');
    expect(exec.join(' ')).not.toContain(workspacePath!); // host path never leaks into the container
  });

  it('destroy removes the temporary workspace and is idempotent', async () => {
    const calls: string[][] = [];
    const backend = new DockerSandboxBackend(programmedRunner(calls), { workspaceRoot });
    const { containerId, workspacePath } = await backend.create(
      spec({ repositoryPath: 'in-sandbox' })
    );

    await backend.destroy(containerId);
    await expect(fs.access(workspacePath!)).rejects.toThrow();

    await expect(backend.destroy(containerId)).resolves.toBeUndefined(); // idempotent
  });

  it('destroy empties container-owned workspace content via a root helper from the same image', async () => {
    const calls: string[][] = [];
    const backend = new DockerSandboxBackend(programmedRunner(calls), { workspaceRoot });
    const { containerId, workspacePath } = await backend.create(
      spec({ repositoryPath: 'in-sandbox' })
    );

    // Simulate files cloned INSIDE the container: a subdir owned/created by
    // the container user that the host process cannot unlink (no write bit).
    const locked = path.join(workspacePath!, 'locked');
    await fs.mkdir(locked);
    await fs.writeFile(path.join(locked, 'f.txt'), 'x');
    await fs.chmod(locked, 0o500);

    await backend.destroy(containerId);

    const helper = calls.find(
      (c) => c[0] === 'run' && c.some((arg) => arg.includes('find /ws -mindepth 1 -delete'))
    );
    expect(helper).toBeDefined();
    expect(helper!.join(' ')).toContain('--user 0:0');
    expect(helper!.join(' ')).toContain('amass/analysis:latest');
    expect(helper!.join(' ')).not.toContain('777');

    // Restore perms so the shared temp root can be torn down.
    await fs.chmod(locked, 0o700).catch(() => undefined);
    await fs.rm(workspacePath!, { recursive: true, force: true }).catch(() => undefined);
  });

  it('sweep removes orphaned workspace directories (tracked and crash-orphaned)', async () => {
    const calls: string[][] = [];
    const backend = new DockerSandboxBackend(programmedRunner(calls), { workspaceRoot });
    const { containerId, workspacePath } = await backend.create(
      spec({ repositoryPath: 'in-sandbox' })
    );
    // Simulate a crash-orphaned workspace dir that is no longer in memory.
    const orphan = path.join(workspaceRoot, 'amass_scan_9_ab12cd34');
    await fs.mkdir(orphan, { recursive: true });

    await backend.sweep();

    await expect(fs.access(workspacePath!)).rejects.toThrow();
    await expect(fs.access(orphan)).rejects.toThrow();
    void containerId;
  });

  it('runtime sandboxes with mountRepository=false stay host-filesystem isolated', async () => {
    const calls: string[][] = [];
    const backend = new DockerSandboxBackend(programmedRunner(calls), { workspaceRoot });

    const { workspacePath } = await backend.create(
      spec({ type: 'runtime', repositoryPath: '/tmp/repo', mountRepository: false })
    );

    expect(workspacePath).toBeUndefined();
    // No image-user probe, no ownership helper, no volume — host stays out.
    expect(calls.some((c) => c.includes('id -u; id -g'))).toBe(false);
    expect(calls.some((c) => c.includes('chown'))).toBe(false);
    expect(calls.some((c) => c.includes('--volume'))).toBe(false);
    const entries = await fs.readdir(workspaceRoot).catch(() => []);
    expect(entries).toHaveLength(0);
  });

  it('absolute host repositoryPath preserves the existing behavior (no provisioning)', async () => {
    const calls: string[][] = [];
    const backend = new DockerSandboxBackend(programmedRunner(calls), { workspaceRoot });

    const { workspacePath } = await backend.create(spec({ repositoryPath: '/tmp/ws/repo' }));

    expect(workspacePath).toBe('/workspace'); // legacy contract unchanged
    expect(calls.some((c) => c.includes('id -u; id -g'))).toBe(false);
    expect(calls.some((c) => c.includes('chown'))).toBe(false);
    const create = calls.find((c) => c[0] === 'run' && c.includes('--name'))!;
    expect(create.join(' ')).toContain('/tmp/ws/repo:/workspace');
    const entries = await fs.readdir(workspaceRoot).catch(() => []);
    expect(entries).toHaveLength(0);
  });

  it('automatically builds missing amass/analysis:local image before resolveImageUser without pulling from Docker Hub', async () => {
    const calls: string[][] = [];
    const customRunner = (record: string[][]): DockerRunner => async (args) => {
      record.push([...args]);
      if (args[0] === 'image' && args[1] === 'inspect' && args[2] === 'amass/analysis:local') {
        return { stdout: '', stderr: 'No such image', exitCode: 1, timedOut: false };
      }
      if (args[0] === 'run' && args.includes('id -u; id -g')) {
        return { stdout: '1001\n1001', stderr: '', exitCode: 0, timedOut: false };
      }
      return { stdout: 'ok', stderr: '', exitCode: 0, timedOut: false };
    };

    const backend = new DockerSandboxBackend(customRunner(calls), { workspaceRoot });
    await backend.create(spec({ image: 'amass/analysis:local', repositoryPath: 'in-sandbox' }));

    const buildCall = calls.find((c) => c[0] === 'build' && c.includes('amass/analysis:local'));
    expect(buildCall).toBeDefined();
    expect(buildCall!.join(' ')).toContain('analysis.Dockerfile');
    expect(calls.some((c) => c.includes('pull'))).toBe(false);
  });
});