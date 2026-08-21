import { describe, expect, it, vi } from 'vitest';
import { probeWithRetries } from './runtime-sandbox-provisioning';
import type { HealthProbeResult } from '../../domain/value-objects/runtime-config';
import type { SandboxContainerInfo } from '../../domain/models/sandbox';

describe('probeWithRetries', () => {
  it('fast-starting application: passes on the first attempt immediately', async () => {
    let callCount = 0;
    const probe = async (): Promise<HealthProbeResult> => {
      callCount += 1;
      return { reachable: true, latencyMs: 2, statusCode: 200 };
    };

    const res = await probeWithRetries(probe, { totalTimeoutMs: 5_000, pollIntervalMs: 50 });
    expect(res.reachable).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(callCount).toBe(1);
  });

  it('slow-starting application: succeeds after several ECONNREFUSED attempts within timeout', async () => {
    let callCount = 0;
    const probe = async (): Promise<HealthProbeResult> => {
      callCount += 1;
      if (callCount < 4) {
        return { reachable: false, latencyMs: 1, detail: 'tcp connect ECONNREFUSED 127.0.0.1:3000' };
      }
      return { reachable: true, latencyMs: 5, statusCode: 200 };
    };

    const res = await probeWithRetries(probe, { totalTimeoutMs: 5_000, pollIntervalMs: 20 });
    expect(res.reachable).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(callCount).toBe(4);
  });

  it('application never becomes ready: fails after total timeout deadline', async () => {
    let callCount = 0;
    const probe = async (): Promise<HealthProbeResult> => {
      callCount += 1;
      return { reachable: false, latencyMs: 1, detail: 'tcp connect ECONNREFUSED 127.0.0.1:3000' };
    };

    const startTime = Date.now();
    const res = await probeWithRetries(probe, { totalTimeoutMs: 150, pollIntervalMs: 30 });
    const elapsed = Date.now() - startTime;

    expect(res.reachable).toBe(false);
    expect(res.detail).toContain('ECONNREFUSED');
    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it('application exits during startup: fails early with exit code diagnostics', async () => {
    let callCount = 0;
    const probe = async (): Promise<HealthProbeResult> => {
      callCount += 1;
      return { reachable: false, latencyMs: 1, detail: 'tcp connect ECONNREFUSED 127.0.0.1:3000' };
    };

    const mockInspect = vi.fn().mockImplementation(async (): Promise<SandboxContainerInfo> => {
      if (callCount >= 2) {
        return { running: false, status: 'exited', exitCode: 1 };
      }
      return { running: true, status: 'running' };
    });

    const sandbox: any = { sandboxId: 'ctr_test' };
    const deps: any = {
      manager: {
        inspectRuntimeContainer: mockInspect,
      },
    };

    const res = await probeWithRetries(probe, {
      totalTimeoutMs: 5_000,
      pollIntervalMs: 20,
      sandbox,
      deps,
    });

    expect(res.reachable).toBe(false);
    expect(res.detail).toContain('container exited with code 1');
  });
});
