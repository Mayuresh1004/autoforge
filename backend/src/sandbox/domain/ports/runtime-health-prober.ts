import type { HealthProbeResult } from '../value-objects/runtime-config';

export interface HealthProbeRequest {
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly timeoutMs: number;
}

/**
 * Healthy means the application actually answers, not just that a container
 * exists: container-state (manager health) → TCP connect → HTTP GET. The
 * prober is the only component that performs the TCP/HTTP verification and
 * is injectable so unit tests can stub it.
 */
export interface RuntimeHealthProber {
  probe(request: HealthProbeRequest): Promise<HealthProbeResult>;
}