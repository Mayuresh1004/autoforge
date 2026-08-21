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

  // Hardened profile (capability + privilege drop).
  command.push('--tmpfs', '/tmp:rw,exec,nodev,nosuid');
  command.push('--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true');
  if (spec.mountRepository !== false) {
    command.push('--read-only');
  }
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
  const args = ['build'];
  for (const [key, value] of Object.entries(request.labels ?? {})) {
    args.push('--label', `${key}=${value}`);
  }
  if (request.dockerfilePath) args.push('-f', request.dockerfilePath);
  args.push('-t', request.imageName, request.contextPath);
  return args;
}

/**
 * In-network app-health probe executed by the throwaway probe container. It
 * mirrors the host-side `TcpHttpHealthProber` semantics exactly: TCP connect
 * first, then HTTP GET — ANY HTTP status counts as reachable (a 4xx/5xx still
 * means the app process answered). Prints one machine-readable line to stdout
 * (`HEALTH_OK <status>` / `HEALTH_ERR <detail>`) and exits 0/1. Runs as
 * `node -e SCRIPT <host> <port> <path> <timeoutMs>` — argv-only, no shell.
 */
export const PROBE_SCRIPT = [
  "const net=require('net'),http=require('http');",
  "const host=process.argv[1],port=Number(process.argv[2]),path=process.argv[3]||'/',timeout=Number(process.argv[4]||5000);",
  "const fail=(stage,e)=>{console.log('HEALTH_ERR '+stage+' '+(e&&e.message||String(e)).replace(/\\s+/g,' '));process.exit(1);};",
  "const tcp=net.connect({host,port});",
  "tcp.setTimeout(timeout);",
  "tcp.once('connect',()=>{",
  "  tcp.destroy();",
  "  const req=http.get({host,port,path,timeout,headers:{connection:'close'}},(res)=>{res.resume();res.on('end',()=>{console.log('HEALTH_OK '+res.statusCode);process.exit(0);});});",
  "  req.once('timeout',()=>fail('http',new Error('timeout after '+timeout+'ms')));",
  "  req.once('error',(e)=>fail('http',e));",
  "  req.end();",
  "});",
  "tcp.once('timeout',()=>fail('tcp',new Error('timeout after '+timeout+'ms')));",
  "tcp.once('error',(e)=>fail('tcp',e));",
].join(' ');

/**
 * Pure builder for the bounded, hardened, throwaway health-probe container.
 * Attached to the SANDBOX'S OWN internal Docker network — the only place the
 * target's internal IP is routable — with the same hardening as sandbox
 * containers (capability drop, no-new-privileges, read-only rootfs, bounded
 * pids). `--rm` guarantees removal on exit; the `amass.manager=1` label lets
 * the sweep reclaim a crashed leftover. Never publishes ports, never mounts
 * the host, never gets external egress (`--internal` nets block it).
 */
export function buildProbeCommand(request: {
  readonly image: string;
  readonly networkId: string;
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly timeoutMs: number;
}): string[] {
  return [
    'run',
    '--rm',
    '--label',
    'amass.manager=1',
    '--network',
    request.networkId,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,exec,nodev,nosuid',
    '--pids-limit',
    '64',
    request.image,
    'node',
    '-e',
    PROBE_SCRIPT,
    request.host,
    String(request.port),
    request.path,
    String(request.timeoutMs),
  ];
}

/**
 * Pure builder for a throwaway, hardened security-tool container attached ONLY
 * to the supplied sandbox Docker network. Leaves target application containers
 * 100% untouched. Never publishes host ports, never mounts host volumes.
 */
export function buildToolCommand(request: {
  readonly image: string;
  readonly networkId: string;
  readonly argv: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}): string[] {
  const args = [
    'run',
    '--rm',
    '--label',
    'amass.manager=1',
    '--network',
    request.networkId,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,exec,nodev,nosuid',
    '--pids-limit',
    '256',
  ];
  if (request.env) {
    for (const [key, value] of Object.entries(request.env)) {
      args.push('--env', `${key}=${value}`);
    }
  }
  args.push(request.image, ...request.argv);
  return args;
}

export { networkArg as dockerNetworkArg };