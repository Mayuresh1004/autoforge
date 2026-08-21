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
  if (input.hostExpose === true && !config.allowHostExpose) {
    throw new HostExposureDeniedError();
  }
  const hostExpose = input.hostExpose === true && config.allowHostExpose;
  return {
    scanId: sandbox.scanId,
    type: 'runtime',
    repositoryPath: sandbox.workspacePath ?? sandbox.id,
    image: sandbox.imageName ?? '',
    egress: 'internal',
    memoryLimit: config.limits.memory,
    cpus: config.limits.cpus,
    pidsLimit: config.limits.pids,
    mountRepository: false,
    env: buildRuntimeContainer({ port: runtime.port, extra: input.env }),
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
  path: string,
  timeoutMsOverride?: number
): (overrideTimeoutMs?: number) => Promise<HealthProbeResult> {
  const target = probeTarget(sandbox);
  return (overrideTimeoutMs?: number) => {
    const timeoutMs = overrideTimeoutMs ?? timeoutMsOverride ?? Math.min(5_000, deps.config.healthTimeoutMs);
    if (sandbox.exposedPort) {
      return deps.prober.probe({
        host: target.host,
        port: target.port,
        path,
        timeoutMs,
      });
    }
    if (!sandbox.networkId) {
      throw new Error(`isolated sandbox ${sandbox.id} has no network for an in-network health probe`);
    }
    return deps.manager.probeNetworkHealth({
      networkId: sandbox.networkId as string,
      host: target.host,
      port: target.port,
      path,
      timeoutMs,
      image: deps.config.probeImage,
    });
  };
}

export interface ProbeRetriesOptions {
  /** Overall readiness deadline in milliseconds (default: 30_000ms). */
  readonly totalTimeoutMs?: number;
  /** Poll interval between retries in milliseconds (default: 1_000ms). */
  readonly pollIntervalMs?: number;
  /** Timeout per individual probe attempt in milliseconds (default: 5_000ms). */
  readonly singleProbeTimeoutMs?: number;
  /** Optional sandbox entity for container state checking. */
  readonly sandbox?: RuntimeSandbox;
  /** Optional provision deps (manager/prober/config) for inspecting container or logs. */
  readonly deps?: RuntimeProvisionDeps;
}

/**
 * Bounded readiness re-probing: retries periodically until totalTimeoutMs
 * (default: 30s) deadline is reached. ECONNREFUSED during application startup is
 * treated as "not ready yet" and retried. If the container process exits or
 * stops early, re-probing terminates immediately with container diagnostic info.
 */
export async function probeWithRetries(
  probe: (singleTimeoutMs?: number) => Promise<HealthProbeResult>,
  options: ProbeRetriesOptions = {}
): Promise<HealthProbeResult> {
  const totalTimeoutMs = options.totalTimeoutMs ?? options.deps?.config.healthTimeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const singleProbeTimeoutMs = options.singleProbeTimeoutMs ?? 5_000;
  const startTime = Date.now();
  const deadline = startTime + totalTimeoutMs;

  let last: HealthProbeResult = {
    reachable: false,
    latencyMs: 0,
    detail: 'unreachable',
  };

  while (Date.now() < deadline) {
    if (options.sandbox?.sandboxId && options.deps?.manager) {
      const info = await options.deps.manager
        .inspectRuntimeContainer(options.sandbox.sandboxId)
        .catch(() => null);
      if (info && !info.running) {
        const exitDetail =
          info.exitCode !== undefined && info.exitCode !== null
            ? `container exited with code ${info.exitCode} (status: ${info.status || 'exited'})`
            : `container is no longer running (status: ${info.status || 'stopped'})`;
        return {
          reachable: false,
          latencyMs: Date.now() - startTime,
          detail: exitDetail,
        };
      }
    }

    const remainingMs = deadline - Date.now();
    const probeTimeout = Math.min(singleProbeTimeoutMs, Math.max(1_000, remainingMs));

    last = await probe(probeTimeout);
    if (last.reachable) {
      return last;
    }

    const nextSleep = Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()));
    if (nextSleep > 0 && Date.now() + nextSleep < deadline) {
      await new Promise((resolve) => setTimeout(resolve, nextSleep));
    } else {
      break;
    }
  }

  return last;
}