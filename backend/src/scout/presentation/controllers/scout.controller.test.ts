import type { Request, Response, NextFunction } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ScoutController } from './scout.controller';
import type { ScoutService } from '../../domain/ports/scout-service';
import type { AttackSurfaceReport } from '../../domain/models/scout-report';
import { EMPTY_SCOUT_SUMMARY } from '../../domain/models/scout-scan';

type Res = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

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

/** Let the asyncHandler's microtask settle before asserting on mocks. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function report(scanId: string): AttackSurfaceReport {
  return {
    scanId,
    scoutScanId: 'scout-1',
    targetUrl: 'http://example.com',
    status: 'COMPLETED',
    health: { reachable: true, statusCode: 200, latencyMs: 1, error: null },
    summary: EMPTY_SCOUT_SUMMARY,
    attackSurface: [],
    technologies: [],
    ports: [],
    services: [],
    errors: [],
  };
}

describe('ScoutController', () => {
  it('POST /scout/run returns 201 with the report', async () => {
    const service = { run: vi.fn().mockResolvedValue(report('scan-1')) } as unknown as ScoutService;
    const controller = new ScoutController(service);
    const res = makeRes();
    const req = { body: { scanId: 'scan-1', targetUrl: 'http://example.com' } } as Request;
    controller.run(req, res as unknown as Response, vi.fn());
    await tick();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.scanId).toBe('scan-1');
  });

  it('POST /scout/run rejects an invalid body via next(err)', async () => {
    const service = { run: vi.fn() } as unknown as ScoutService;
    const controller = new ScoutController(service);
    const res = makeRes();
    const catcher = nextSpy();
    controller.run({ body: { scanId: '' } } as Request, res as unknown as Response, catcher.next);
    await tick();
    expect(catcher.lastErr()).toBeTruthy();
    expect(service.run).not.toHaveBeenCalled();
  });

  it('GET /scout/:scoutScanId returns the stored run, or passes 404 to next', async () => {
    const service = { getScoutScan: vi.fn().mockResolvedValue(null) } as unknown as ScoutService;
    const controller = new ScoutController(service);
    const res = makeRes();
    const catcher = nextSpy();
    controller.getScoutRun(
      { params: { scoutScanId: 'missing' } } as unknown as Request,
      res as unknown as Response,
      catcher.next,
    );
    await tick();
    expect(catcher.lastErr()).toBeTruthy();

    const filled = {
      scoutScan: {
        id: 'x', scanId: 's', targetUrl: 'u', status: 'COMPLETED',
        startedAt: new Date(), completedAt: new Date(), summary: EMPTY_SCOUT_SUMMARY, createdAt: new Date(),
      },
      attackSurface: [],
      technologies: [],
      ports: [],
      services: [],
    };
    (service.getScoutScan as ReturnType<typeof vi.fn>).mockResolvedValue(filled);
    const res2 = makeRes();
    controller.getScoutRun(
      { params: { scoutScanId: 'x' } } as unknown as Request,
      res2 as unknown as Response,
      vi.fn(),
    );
    await tick();
    expect(res2.json.mock.calls[0][0].data.scoutScan.id).toBe('x');
  });

  it('GET /scout/:scoutScanId/ports returns only ports', async () => {
    const service = {
      getScoutScan: vi.fn().mockResolvedValue({
        scoutScan: {
          id: 'x', scanId: 's', targetUrl: 'u', status: 'COMPLETED',
          startedAt: new Date(), completedAt: new Date(), summary: EMPTY_SCOUT_SUMMARY, createdAt: new Date(),
        },
        attackSurface: [],
        technologies: [],
        ports: [{ port: 80, protocol: 'tcp', state: 'open', service: 'http' }],
        services: [],
      }),
    } as unknown as ScoutService;
    const controller = new ScoutController(service);
    const res = makeRes();
    controller.getPorts(
      { params: { scoutScanId: 'x' } } as unknown as Request,
      res as unknown as Response,
      vi.fn(),
    );
    await tick();
    expect(res.json.mock.calls[0][0].data.ports).toHaveLength(1);
  });
});