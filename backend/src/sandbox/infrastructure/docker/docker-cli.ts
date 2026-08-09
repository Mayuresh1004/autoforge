import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SandboxNetworkPolicy, SandboxSpec } from '../../domain/models/sandbox';

const execFileAsync = promisify(execFile);

export interface CliOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}

export type DockerRunner = (args: readonly string[], timeoutMs?: number) => Promise<CliOutput>;

/** Default runner uses the local `docker` binary (argv-only, no shell). */
export const defaultDockerRunner: DockerRunner = async (args, timeoutMs = 30_000) => {
  try {
    const { stdout, stderr } = await execFileAsync('docker', [...args], {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0, timedOut: false };
  } catch (error) {
    const err = error as { code?: number | null; killed?: boolean; signal?: string; stdout?: string; stderr?: string };
    return {
      stdout: (err.stdout ?? '') as string,
      stderr: (err.stderr ?? '') as string,
      exitCode: err.killed === true && err.signal === 'SIGTERM' ? null : (err.code ?? null),
      timedOut: err.killed === true && err.signal === 'SIGTERM',
    };
  }
};

type NetworkKind = 'none' | 'bridge' | 'internal';

/** Maps a sandbox network policy to a docker network choice. */
function networkArg(policy: SandboxNetworkPolicy): { kind: NetworkKind; name?: string } {
  switch (policy.egress) {
    case 'none':
      return { kind: 'none' };
    case 'egress':
      return { kind: 'bridge' };
    case 'internal':
    default:
      return { kind: 'internal' };
  }
}

/**
 * Pure builder: a hardened, named, detached container that stays alive so the
 * manager can `exec`, `logs`, `restart` and eventually destroy it. The repo
 * working tree is the only host writable path — unless it is a RUNTIME
 * sandbox (`mountRepository: false`), where the host filesystem never enters
 * the container and the image payload runs instead (image CMD or explicit
 * argv). Kept pure for unit testing.
 */
export function buildCreateCommand(
  spec: SandboxSpec,
  name: string,
  mountPath = '/workspace'
): string[] {
  const network = networkArg(spec.network);
  const networkValue =
    network.kind === 'internal' ? `amass-net-${spec.scanId}` : network.kind;

  const command: string[] = [
    'run',
    '-d',
    '--rm',
    '--name',
    name,
    '--label',
    'amass.manager=1',
    '--label',
    `amass.scan=${spec.scanId}`,
    '--network',
    networkValue,
  ];

  // Hardened profile (capability + privilege drop, read-only rootfs).
  command.push('--read-only', '--tmpfs', '/tmp:rw,exec,nodev,nosuid');
  command.push('--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true');
  if (typeof spec.uid === 'number') command.push('--user', String(spec.uid));
  if (spec.memoryLimit) command.push('--memory', spec.memoryLimit);
  if (spec.cpus) command.push('--cpus', String(spec.cpus));
  if (spec.pidsLimit) command.push('--pids-limit', String(spec.pidsLimit));

  // Explicit env only (runtime sandboxes get a service-built allowlist).
  if (spec.env && Object.keys(spec.env).length > 0) {
    for (const [key, value] of Object.entries(spec.env)) {
      command.push('--env', `${key}=${value}`);
    }
  }

  // Optional localhost-only dynamic port (never 0.0.0.0).
  if (spec.hostPublishLocalhost) {
    command.push('-p', `127.0.0.1::${spec.hostPublishLocalhost.containerPort}`);
  }

  const useImageDefault =
    spec.appCommand !== undefined && spec.appCommand.length === 0;

  if (spec.mountRepository !== false) {
    // Repo tree is the only host writable path; workdir inside it. The host
    // source MUST be an absolute path: analysis sandboxes either pass a real
    // host path or (via the DockerSandboxBackend) request a backend-owned
    // ephemeral workspace, which is substituted with an absolute path before
    // this builder runs. A bare relative value (e.g. the synthetic
    // 'in-sandbox' marker) must never become an arbitrary host mount.
    if (!spec.repositoryPath.startsWith('/')) {
      throw new Error(
        `refusing to bind-mount non-absolute repositoryPath '${spec.repositoryPath}'`
      );
    }
    command.push(
      '--volume',
      `${spec.repositoryPath}:${mountPath}`,
      '--workdir',
      mountPath
    );
  } else {
    // Host filesystem stays out. No --workdir: the image's own WORKDIR
    // governs so a relative image CMD (e.g. `python app.py`) resolves
    // inside the app's directory, not an arbitrary host-ish /tmp.
  }

  command.push(spec.image);
  if (spec.appCommand === undefined) {
    // Analysis sandboxes: keepalive tail so the manager can exec into them.
    command.push('tail', '-f', '/dev/null');
  } else if (spec.appCommand.length > 0) {
    command.push(...spec.appCommand);
  } else {
    // [] → let the image's own CMD run (runtime sandboxes).
    void useImageDefault;
  }
  return command;
}

/** Pure builder for `docker build` (single-line output, labeled). */
export function buildImageCommand(request: {
  readonly contextPath: string;
  readonly dockerfilePath?: string;
  readonly imageName: string;
  readonly labels?: Readonly<Record<string, string>>;
}): string[] {
  const args = ['build', '-q'];
  for (const [key, value] of Object.entries(request.labels ?? {})) {
    args.push('--label', `${key}=${value}`);
  }
  if (request.dockerfilePath) args.push('-f', request.dockerfilePath);
  args.push('-t', request.imageName, request.contextPath);
  return args;
}

export { networkArg as dockerNetworkArg };