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
 * working tree is the only host writable path. Kept pure for unit testing.
 */
export function buildCreateCommand(
  spec: SandboxSpec,
  name: string,
  mountPath = '/workspace'
): string[] {
  const network = networkArg(spec.network);
  const networkValue = network.kind === 'internal' ? `amass-net-${spec.scanId}` : network.kind;

  return [
    'run', '-d', '--rm', '--name', name,
    '--label', 'amass.manager=1',
    '--label', `amass.scan=${spec.scanId}`,
    '--network', networkValue,
  ]
    // Hardened profile (capability + privilege drop, read-only rootfs).
    .concat(['--read-only', '--tmpfs', '/tmp:rw,exec,nodev,nosuid'])
    .concat(['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true'])
    // Non-root user + resource limits.
    .concat(typeof spec.uid === 'number' ? ['--user', String(spec.uid)] : [])
    .concat(spec.memoryLimit ? ['--memory', spec.memoryLimit] : [])
    .concat(spec.cpus ? ['--cpus', String(spec.cpus)] : [])
    // Repo working tree is the only host writable path; workdir inside it.
    .concat([`--volume`, `${spec.repositoryPath}:${mountPath}`, '--workdir', mountPath])
    .concat([spec.image, 'tail', '-f', '/dev/null']);
}

export { networkArg as dockerNetworkArg };