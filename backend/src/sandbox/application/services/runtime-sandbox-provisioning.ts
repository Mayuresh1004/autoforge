import type { RuntimeSandboxConfig } from '../../../config';
import type { RuntimeSandbox } from '../../domain/entities/runtime-sandbox';
import type {
  CreateSandboxInput,
  SandboxManager,
} from '../../domain/ports/sandbox-manager';
import type { RuntimeHealthProber } from '../../domain/ports/runtime-health-prober';
import type { RuntimeConfig } from '../../domain/value-objects/runtime-config';
import { buildRuntimeContainer } from './runtime-env-builder';

/**
 * Provisioning internals for the runtime-sandbox lifecycle: turning the
 * resolved runtime strategy into a hardened container through the manager
 * (the only Docker owner) and verifying real app liveness with bounded
 * re-probing. Kept separate from the service so both stay < 300 lines.
 */

const HEALTH_PROBE_RETRIES = 4;
const HEALTH_PROBE_BACKOFF_MS = 750;

export interface RuntimeProvisionDeps {
  readonly manager: SandboxManager;
  readonly prober: RuntimeHealthProber;
  readonly config: RuntimeSandboxConfig;
}

export interface ProvisionContact {
  readonly containerId: string;
  readonly networkId: string | null;
  readonly ip: string;
  readonly publishedPort: number | null;
}

/**
 * The hardened container request for a runtime sandbox: internal-only egress,
 * no host mounts (the image carries the payload), explicit env allowlist,
 * bounded CPU/memory/PIDs, image-default CMD, optional localhost-only
 * dynamic host port. Host env never leaks (allowlist only).
 */
export function buildProvisionRequest(
  sandbox: RuntimeSandbox,
  runtime: RuntimeConfig,
  input: { hostExpose?: boolean },
  config: RuntimeSandboxConfig
): CreateSandboxInput {
  const hostExpose = input.hostExpose === true && config.allowHostExpose;
  return {
    scanId: sandbox.scanId,
    type: 'runtime',
    // The image carries the payload — repositoryPath is only an identifier.
    repositoryPath: sandbox.workspacePath ?? sandbox.id,
    image: sandbox.imageName ?? '',
    egress: 'internal',
    memoryLimit: config.limits.memory,
    cpus: config.limits.cpus,
    pidsLimit: config.limits.pids,
    mountRepository: false,
    env: buildRuntimeContainer({ port: runtime.port }),
    appCommand: [],
    ...(hostExpose ? { hostPublishLocalhost: { containerPort: runtime.port } } : {}),
  };
}

/**
 * Create → wait-ready → resolve the reachable address. A container that is
 * merely RUNNING never means READY — liveness is re-verified separately via
 * probeWithRetries.
 */
export async function provisionContainer(
  deps: RuntimeProvisionDeps,
  request: CreateSandboxInput
): Promise<ProvisionContact> {
  const created = await deps.manager.createSandbox(request);
  await deps.manager.waitUntilReady(created.id, deps.config.startTimeoutMs);
  const info = await deps.manager
    .inspectRuntimeContainer(created.containerId ?? created.id)
    .catch(() => null);
  const ip = info?.ipAddress ?? created.ipAddress;
  if (!ip) throw new Error(`container ${created.id} has no network address`);
  return {
    containerId: created.id,
    networkId: created.networkId ?? null,
    ip,
    publishedPort: request.hostPublishLocalhost ? (created.exposedPort ?? null) : null,
  };
}

/** Where probes point: a sandbox exposed on localhost or its internal IP. */
export function probeTarget(sandbox: RuntimeSandbox): { host: string; port: number } {
  if (sandbox.exposedPort) return { host: '127.0.0.1', port: sandbox.exposedPort };
  if (sandbox.internalHost && sandbox.internalPort) {
    return { host: sandbox.internalHost, port: sandbox.internalPort };
  }
  throw new Error('sandbox has no target coordinates');
}

/**
 * Bounded readiness re-probing: up to HEALTH_PROBE_RETRIES attempts with a
 * short sleep between them (a container can report running before the app
 * binds its port). Never unbounded — the config timeout caps each attempt.
 */
export async function probeWithRetries(
  deps: RuntimeProvisionDeps,
  host: string,
  port: number,
  path: string
): Promise<Awaited<ReturnType<RuntimeHealthProber['probe']>>> {
  let last: Awaited<ReturnType<RuntimeHealthProber['probe']>> = {
    reachable: false,
    latencyMs: 0,
    detail: 'unreachable',
  };
  for (let attempt = 0; attempt <= HEALTH_PROBE_RETRIES; attempt += 1) {
    last = await deps.prober.probe({
      host,
      port,
      path,
      timeoutMs: deps.config.healthTimeoutMs,
    });
    if (last.reachable) return last;
    if (attempt < HEALTH_PROBE_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, HEALTH_PROBE_BACKOFF_MS));
    }
  }
  return last;
}