import net from 'node:net';
import http from 'node:http';
import type { HealthProbeResult } from '../../domain/value-objects/runtime-config';
import type { HealthProbeRequest, RuntimeHealthProber } from '../../domain/ports/runtime-health-prober';

/**
 * Real TCP + HTTP prober used for runtime sandbox health checks. Verifies
 * the application actually answers (connect + GET) — a running container is
 * never treated as healthy on its own. All probes bounded by the timeout.
 * Never logs payloads; only status/latency.
 */
export class TcpHttpHealthProber implements RuntimeHealthProber {
  async probe(request: HealthProbeRequest): Promise<HealthProbeResult> {
    const started = Date.now();
    try {
      await tcpConnect(request.host, request.port, request.timeoutMs);
    } catch (error) {
      return {
        reachable: false,
        latencyMs: Date.now() - started,
        detail: `tcp connect to ${request.host}:${request.port} failed: ${message(error)}`,
      };
    }

    const httpProbe = await httpGet(
      request.host,
      request.port,
      request.path,
      Math.max(1_000, request.timeoutMs - (Date.now() - started))
    );
    if (!httpProbe.ok) {
      return {
        reachable: false,
        latencyMs: Date.now() - started,
        detail: httpProbe.detail,
      };
    }
    return {
      reachable: true,
      latencyMs: Date.now() - started,
      statusCode: httpProbe.statusCode,
    };
  }
}

interface HttpProbeOutcome {
  readonly ok: boolean;
  readonly statusCode?: number;
  readonly detail?: string;
}

function httpGet(host: string, port: number, requestPath: string, timeoutMs: number): Promise<HttpProbeOutcome> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host,
        port,
        path: requestPath,
        method: 'GET',
        timeout: timeoutMs,
        headers: { connection: 'close' },
      },
      (res) => {
        res.resume(); // drain so the socket can report completion
        res.on('end', () => {
          // Any HTTP status means the app process answered — reachable.
          resolve({ ok: true, statusCode: res.statusCode });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, detail: `http GET ${requestPath} timed out (${timeoutMs}ms)` });
    });
    req.on('error', (err) => resolve({ ok: false, detail: `http error: ${err.message}` }));
    req.end();
  });
}

function tcpConnect(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const onError = (err: Error): void => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('timeout', () =>
      onError(new Error(`tcp connect timed out (${timeoutMs}ms)`))
    );
    socket.once('error', onError);
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}