import type { RuntimeSandboxConfig } from '../../../config';
import type { RuntimeSandbox } from '../../domain/entities/runtime-sandbox';
import { RuntimeSandboxHostExposureDeniedError as HostExposureDeniedError } from '../../domain/errors/runtime-sandbox.errors';
import type {
  CreateSandboxInput,
  SandboxManager,
} from '../../domain/ports/sandbox-manager';
import type { RuntimeHealthProber } from '../../domain/ports/runtime-health-prober';
import type { HealthProbeResult, RuntimeConfig } from '../../domain/value-objects/runtime-config';
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
 * bounded CPU/memory/PIDs, runtime-config start command (image CMD or a
 * derived stack-aware command), optional localhost-only dynamic host port.
 * Host env never leaks (allowlist only).
 */
export function buildProvisionRequest(
  sandbox: RuntimeSandbox,
  runtime: RuntimeConfig,
  input: { hostExpose?: boolean; env?: Readonly<Record<string, string>> },
  config: RuntimeSandboxConfig
): CreateSandboxInput {
  // Fail fast: an EXPLICIT hostExpose request must never be silently dropped
  // (that would leave probes pointed at an unreachable internal IP). The
  // service also guards before any provisioning side effect; this is the
  // defense-in-depth for direct callers.
  if (input.hostExpose === true && !config.allowHostExpose) {
    throw new HostExposureDeniedError();
  }
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
    env: buildRuntimeContainer({ port: runtime.port, extra: input.env }),
    // The runtime config's command governs: [] = image default CMD (Mode 1
    // Dockerfiles WITH a CMD, Mode 2 generated images), non-empty = explicit
    // argv (Mode 1 Dockerfiles WITHOUT a CMD derive a stack-aware start
    // command — e.g. NodeGoat's `npm start`).
    appCommand: runtime.command.length > 0 ? runtime.command : [],
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
 * The bounded probe call for a sandbox, resolved against its connectivity
 * model:
 *  - host-exposed (`exposedPort` set): the host prober targets the
 *    localhost-only published port (reachable from the backend process),
 *  - isolated (default): NO host path exists — the internal IP is only
 *    routable from other containers on the same `--internal` Docker network,
 *    so the probe runs from a throwaway probe container attached to the
 *    sandbox's own network via the manager (the only Docker owner).
 */
export function buildHealthProbe(
  deps: RuntimeProvisionDeps,
  sandbox: RuntimeSandbox,
  path: string
): () => Promise<HealthProbeResult> {
  const target = probeTarget(sandbox);
  if (sandbox.exposedPort) {
    return () =>
      deps.prober.probe({
        host: target.host,
        port: target.port,
        path,
        timeoutMs: deps.config.healthTimeoutMs,
      });
  }
  if (!sandbox.networkId) {
    throw new Error(`isolated sandbox ${sandbox.id} has no network for an in-network health probe`);
  }
  return () =>
    deps.manager.probeNetworkHealth({
      networkId: sandbox.networkId as string,
      host: target.host,
      port: target.port,
      path,
      timeoutMs: deps.config.healthTimeoutMs,
      image: deps.config.probeImage,
    });
}

/**
 * Bounded readiness re-probing: up to HEALTH_PROBE_RETRIES attempts with a
 * short sleep between them (a container can report running before the app
 * binds its port). Never unbounded — the config timeout caps each attempt.
 */
export async function probeWithRetries(
  probe: () => Promise<HealthProbeResult>
): Promise<HealthProbeResult> {
  let last: HealthProbeResult = {
    reachable: false,
    latencyMs: 0,
    detail: 'unreachable',
  };
  for (let attempt = 0; attempt <= HEALTH_PROBE_RETRIES; attempt += 1) {
    last = await probe();
    if (last.reachable) return last;
    if (attempt < HEALTH_PROBE_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, HEALTH_PROBE_BACKOFF_MS));
    }
  }
  return last;
}