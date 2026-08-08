import type { Request, Response, NextFunction } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { SniperController } from './sniper.controller';
import type { ProofOfConcept, ExploitResultDetail, AttemptRecord } from '../../domain/models/verification';
import type { SniperService, SniperRunReport } from '../../domain/ports/sniper-service';
import { SandboxUnavailableError, TargetNotFoundError } from '../../domain/errors/sniper.errors';

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
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function exploit(id = 'exp-1'): ProofOfConcept {
  return {
    id,
    targetId: 't-1',
    scanId: 'scan-1',
    vulnerabilityId: null,
    type: 'SQL_INJECTION',
    status: 'CONFIRMED',
    confidence: 0.9,
    confidenceBreakdown: null,
    endpoint: 'http://app:3000/api/search?q=1',
    method: 'GET',
    parameter: 'q',
    verifier: 'sql-injection',
    tool: 'sqlmap',
    reason: 'confirmed',
    evidence: [],
    attacks: 1,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 12,
  };
}
function attempt(): AttemptRecord {
  return {
    id: 'att-1',
    exploitId: 'exp-1',
    attemptNumber: 1,
    verifier: 'sql-injection',
    tool: 'sqlmap',
    status: 'CONFIRMED',
    stdout: null,
    stderr: null,
    errorMessage: null,
    exitCode: 0,
    timedOut: false,
    retried: false,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 11,
  };
}
function detail(): ExploitResultDetail {
  return { exploit: exploit(), attempts: [attempt()] };
}

describe('SniperController', () => {
  it('POST /sniper/run returns 201 with the run report', async () => {
    const report: SniperRunReport = { scanId: 'scan-1', sandboxId: 'sbx-1', results: [] };
    const service = { run: vi.fn().mockResolvedValue(report) } as unknown as SniperService;
    const controller = new SniperController(service);
    const res = makeRes();
    controller.run(
      { body: { scanId: 'scan-1', sandboxId: 'sbx-1', baseUrl: 'http://app:3000/', targetIds: ['t-1'] } } as Request,
      res as unknown as Response,
      vi.fn()
    );
    await tick();
    expect(service.run).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ scanId: 'scan-1' }) }));
  });

  it('rejects a malformed body with a 400 validation error (Zod)', async () => {
    const service = { run: vi.fn() } as unknown as SniperService;
    const controller = new SniperController(service);
    const res = makeRes();
    const { next, lastErr } = nextSpy();
    controller.run({ body: { sandboxId: 'sbx-1' } } as unknown as Request, res as unknown as Response, next);
    await tick();
    expect(service.run).not.toHaveBeenCalled();
    expect((lastErr() as { message: string }).message).toContain('Invalid request body');
  });

  it('rejects unknown option keys (strict schema)', async () => {
    const service = { run: vi.fn() } as unknown as SniperService;
    const controller = new SniperController(service);
    const res = makeRes();
    const { next, lastErr } = nextSpy();
    controller.run(
      {
        body: { scanId: 's', sandboxId: 'sbx', baseUrl: 'http://app:3000/', targetIds: ['t'], options: { threads: 99 } },
      } as unknown as Request,
      res as unknown as Response,
      next
    );
    await tick();
    expect(service.run).not.toHaveBeenCalled();
    expect((lastErr() as { message: string }).message).toContain('Invalid request body');
  });

  it('maps SandboxUnavailableError to a 503 ServiceUnavailableError', async () => {
    const service = {
      run: vi.fn().mockRejectedValue(new SandboxUnavailableError('sandbox not ready')),
    } as unknown as SniperService;
    const controller = new SniperController(service);
    const res = makeRes();
    const { next, lastErr } = nextSpy();
    const body = { scanId: 's', sandboxId: 'sbx', baseUrl: 'http://app:3000/', targetIds: ['t'] };
    controller.run({ body } as unknown as Request, res as unknown as Response, next);
    await tick();
    const err = lastErr() as { message: string };
    expect(service.run).toHaveBeenCalled();
    expect(err.message).toContain('sandbox not ready');
  });

  it('maps TargetNotFoundError to a 404 NotFoundError', async () => {
    const service = { run: vi.fn().mockRejectedValue(new TargetNotFoundError('t-9')) } as unknown as SniperService;
    const controller = new SniperController(service);
    const res = makeRes();
    const { next, lastErr } = nextSpy();
    controller.run(
      { body: { scanId: 's', sandboxId: 'sbx', baseUrl: 'http://app:3000/', targetIds: ['t-9'] } } as unknown as Request,
      res as unknown as Response,
      next
    );
    await tick();
    expect((lastErr() as { message: string }).message).toContain('t-9');
  });

  it('GET /sniper/:id returns the exploit', async () => {
    const service = { getExploit: vi.fn().mockResolvedValue(exploit()) } as unknown as SniperService;
    const controller = new SniperController(service);
    const res = makeRes();
    controller.get({ params: { id: 'exp-1' } } as unknown as Request, res as unknown as Response, vi.fn());
    await tick();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: 'exp-1' }) }));
  });

  it('GET /sniper/:id 404s for an unknown exploit', async () => {
    const service = { getExploit: vi.fn().mockResolvedValue(null) } as unknown as SniperService;
    const controller = new SniperController(service);
    const res = makeRes();
    const { next, lastErr } = nextSpy();
    controller.get({ params: { id: 'missing' } } as unknown as Request, res as unknown as Response, next);
    await tick();
    expect((lastErr() as { message: string }).message).toContain('missing');
  });

  it('GET /sniper/:id/results returns attempts alongside the exploit', async () => {
    const service = { getExploitResults: vi.fn().mockResolvedValue(detail()) } as unknown as SniperService;
    const controller = new SniperController(service);
    const res = makeRes();
    controller.results({ params: { id: 'exp-1' } } as unknown as Request, res as unknown as Response, vi.fn());
    await tick();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ attempts: expect.any(Array) }) })
    );
  });

  it('GET /sniper/targets/:targetId lists every exploit recorded for the target', async () => {
    const service = { listExploitsForTarget: vi.fn().mockResolvedValue([exploit(), exploit('exp-2')]) } as unknown as SniperService;
    const controller = new SniperController(service);
    const res = makeRes();
    controller.targetExploits({ params: { targetId: 't-1' } } as unknown as Request, res as unknown as Response, vi.fn());
    await tick();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Array) }));
  });
});

type AttemptId = AttemptRecord;