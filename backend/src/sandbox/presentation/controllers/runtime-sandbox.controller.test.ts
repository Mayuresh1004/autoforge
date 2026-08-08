import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { RuntimeSandboxController } from './runtime-sandbox.controller';
import type { RuntimeSandboxService } from '../../domain/ports/runtime-sandbox-service';
import type { RuntimeSandbox } from '../../domain/entities/runtime-sandbox';
import {
  RuntimeSandboxCapacityError,
  RuntimeSandboxCreationError,
  RuntimeSandboxForbiddenError,
  RuntimeSandboxNotFoundError,
  UnsupportedRuntimeError,
} from '../../domain/errors/runtime-sandbox.errors';

type Res = { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
function makeRes(): Res {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}
function nextSpy(): { next: NextFunction; lastErr: () => unknown } {
  const errors: unknown[] = [];
  const next: NextFunction = (err?: unknown) => {
    if (err) errors.push(err);
  };
  return { next, lastErr: () => errors[errors.length - 1] };
}
const req = (overrides: Partial<Request> = {}): Request =>
  ({ query: {}, params: {}, body: {}, headers: {}, ...overrides }) as Request;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function readySandbox(): RuntimeSandbox {
  return {
    id: 'rts_abc',
    scanId: 'scan-1',
    status: 'READY',
    repository: { url: 'https://github.com/x/y' },
    name: null,
    sandboxId: 'sbx_scan-1_1234',
    imageId: 'sha256:abc',
    imageName: 'amass-rt-scan-1_abcd',
    networkId: 'amass-net-scan-1',
    targetUrl: 'http://172.19.0.10:8000',
    internalHost: '172.19.0.10',
    internalPort: 8000,
    exposedPort: null,
    workspacePath: '/tmp/rt-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T01:00:00.000Z',
    destroyedAt: null,
    failureStage: null,
    failureReason: null,
  };
}

function stubService(overrides: Partial<RuntimeSandboxService> = {}): RuntimeSandboxService {
  return {
    create: vi.fn(async () => readySandbox()),
    get: vi.fn(async () => readySandbox()),
    healthCheck: vi.fn(async () => ({
      ok: true,
      status: 'READY' as const,
      latencyMs: 5,
      statusCode: 200,
      checkedAt: new Date().toISOString(),
    })),
    destroy: vi.fn(async () => ({ ...readySandbox(), status: 'DESTROYED' as const })),
    expire: vi.fn(async () => readySandbox()),
    cleanupExpired: vi.fn(async () => 0),
    limits: { cpus: 0.5, memory: '512m', pids: 256 },
    ...overrides,
  };
}

describe('RuntimeSandboxController', () => {
  it('POST create → 201 with the provisioned sandbox', async () => {
    const service = stubService();
    const controller = new RuntimeSandboxController(service);
    const res = makeRes();
    const { next, lastErr } = nextSpy();

    await controller.create(
      req({ body: { scanId: 'scan-1', repository: { url: 'https://github.com/x/y' } } }),
      res as unknown as Response,
      next
    );
    await tick();
    expect(lastErr()).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(JSON.parse(JSON.stringify(res.json.mock.calls[0][0])).data.status).toBe('READY');
    expect(JSON.parse(JSON.stringify(res.json.mock.calls[0][0])).data.containerId).toBeUndefined();
  });

  it('POST create rejects malformed bodies with a validation error', async () => {
    const controller = new RuntimeSandboxController(stubService());
    const res = makeRes();
    const { next, lastErr } = nextSpy();

    await controller.create(req({ body: { scanId: 'scan-1' } }), res as unknown as Response, next);
    await tick();
    const err = lastErr() as { statusCode: number };
    expect(err.statusCode).toBe(400);
  });

  it('maps capacity → 429 with structured details', async () => {
    const controller = new RuntimeSandboxController(
      stubService({ create: vi.fn(async () => { throw new RuntimeSandboxCapacityError(3, 3); }) })
    );
    const res = makeRes();
    const { next, lastErr } = nextSpy();

    await controller.create(
      req({ body: { scanId: 'scan-1', repository: { url: 'https://github.com/x/y' } } }),
      res as unknown as Response,
      next
    );
    await tick();
    const err = lastErr() as { statusCode: number; code: string; details: { active: number; max: number } };
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe('CAPACITY');
    expect(err.details).toEqual({ active: 3, max: 3 });
  });

  it('maps unsupported runtime → 422 with UNSUPPORTED_RUNTIME', async () => {
    const controller = new RuntimeSandboxController(
      stubService({ create: vi.fn(async () => { throw new UnsupportedRuntimeError(['run.sh']); }) })
    );
    const res = makeRes();
    const { next, lastErr } = nextSpy();

    await controller.create(
      req({ body: { scanId: 'scan-1', repository: { url: 'https://github.com/x/y' } } }),
      res as unknown as Response,
      next
    );
    await tick();
    const err = lastErr() as { statusCode: number; code: string };
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('UNSUPPORTED_RUNTIME');
  });

  it('maps creation failure → 422 carrying the FAILED record', async () => {
    const failed = { ...readySandbox(), status: 'FAILED' as const, failureStage: 'HEALTH_CHECK' as const };
    const controller = new RuntimeSandboxController(
      stubService({
        create: vi.fn(async () => {
          throw new RuntimeSandboxCreationError('HEALTH_CHECK', 'unreachable', new Error('x'), failed);
        }),
      })
    );
    const res = makeRes();
    const { next, lastErr } = nextSpy();

    await controller.create(
      req({ body: { scanId: 'scan-1', repository: { url: 'https://github.com/x/y' } } }),
      res as unknown as Response,
      next
    );
    await tick();
    const err = lastErr() as { statusCode: number; code: string; details: { stage: string; sandbox: { status: string } } };
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('RUNTIME_SANDBOX_CREATION_FAILED');
    expect(err.details.stage).toBe('HEALTH_CHECK');
    expect(err.details.sandbox.status).toBe('FAILED');
  });

  it('GET passes scanId scoping and maps 404/403', async () => {
    const controller = new RuntimeSandboxController(
      stubService({
        get: vi.fn(async (_id: string, options?: { scanId?: string }) => {
          if (options?.scanId && options.scanId !== 'scan-1') throw new RuntimeSandboxForbiddenError('rts_abc', options.scanId);
          throw new RuntimeSandboxNotFoundError('rts_abc');
        }),
      })
    );
    const res = makeRes();
    const { next, lastErr } = nextSpy();

    await controller.get(req({ params: { id: 'rts_abc' }, query: { scanId: 'other' } }), res as unknown as Response, next);
    await tick();
    expect((lastErr() as { statusCode: number }).statusCode).toBe(403);

    await controller.get(req({ params: { id: 'rts_abc' } }), res as unknown as Response, next);
    await tick();
    expect((lastErr() as { statusCode: number }).statusCode).toBe(404);
  });

  it('DELETE is exposed and delegates to destroy (idempotent at service level)', async () => {
    const destroy = vi.fn(async () => ({ ...readySandbox(), status: 'DESTROYED' as const }));
    const controller = new RuntimeSandboxController(stubService({ destroy }));
    const res = makeRes();
    const { next, lastErr } = nextSpy();

    await controller.destroy(req({ params: { id: 'rts_abc' } }), res as unknown as Response, next);
    await tick();
    expect(lastErr()).toBeUndefined();
    expect(destroy).toHaveBeenCalledWith('rts_abc', { scanId: undefined });
    expect(res.json).toHaveBeenCalled();
  });

  it('POST health delegates and returns probe outcome', async () => {
    const healthCheck = vi.fn(async () => ({
      ok: false,
      status: 'DESTROYED' as const,
      detail: 'gone',
      checkedAt: new Date().toISOString(),
    }));
    const controller = new RuntimeSandboxController(stubService({ healthCheck }));
    const res = makeRes();
    const { next, lastErr } = nextSpy();

    await controller.health(req({ params: { id: 'rts_abc' } }), res as unknown as Response, next);
    await tick();
    expect(lastErr()).toBeUndefined();
    expect(healthCheck).toHaveBeenCalledWith('rts_abc', { scanId: undefined });
    const payload = JSON.parse(JSON.stringify(res.json.mock.calls[0][0])).data;
    expect(payload.ok).toBe(false);
    expect(payload.sandboxId).toBe('rts_abc');
  });
});