import type { Request, Response, NextFunction } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { PlannerController } from './planner.controller';
import type { PlannerService } from '../../domain/ports/planner';
import type { AttackPlan } from '../../domain/models/plan';

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

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function plan(scanId: string): AttackPlan {
  return {
    id: 'plan-1',
    scanId,
    createdAt: new Date().toISOString(),
    coveredSurfaces: 1,
    coveredFindings: 0,
    summary: { targets: 1, critical: 0, high: 1, medium: 0, low: 0 },
    targets: [
      {
        targetId: 't-1',
        endpoint: 'http://app.test/api/search',
        method: 'POST',
        candidateVulnerabilities: ['SQL Injection'],
        priority: 85,
        recommendedTool: 'sqlmap',
        reason: '… priority 85/100; hypothesis: SQL Injection.',
        requiresAuthentication: false,
        estimatedRisk: 'HIGH',
        breakdown: [{ label: 'scout-risk HIGH', points: 30 }],
      },
    ],
  };
}

describe('PlannerController', () => {
  it('POST /planner/run returns 201 with the generated plan', async () => {
    const service = { generate: vi.fn().mockResolvedValue(plan('scan-1')) } as unknown as PlannerService;
    const controller = new PlannerController(service);
    const res = makeRes();
    controller.run(
      { body: { scanId: 'scan-1' } } as Request,
      res as unknown as Response,
      vi.fn(),
    );
    await tick();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.scanId).toBe('scan-1');
  });

  it('POST /planner/run rejects an invalid body via next(err)', async () => {
    const service = { generate: vi.fn() } as unknown as PlannerService;
    const controller = new PlannerController(service);
    const res = makeRes();
    const catcher = nextSpy();
    controller.run({ body: {} } as Request, res as unknown as Response, catcher.next);
    await tick();
    expect(service.generate).not.toHaveBeenCalled();
    expect(catcher.lastErr()).toBeInstanceOf(Error);
  });

  it('GET /planner/plans/:planId returns targets sorted by priority', async () => {
    const service = { getPlan: vi.fn().mockResolvedValue(plan('scan-1')) } as unknown as PlannerService;
    const controller = new PlannerController(service);
    const res = makeRes();
    controller.getPlan({ params: { planId: 'plan-1' } } as unknown as Request, res as unknown as Response, vi.fn());
    await tick();
    expect(res.json.mock.calls[0][0].data.targets[0].priority).toBe(85);
  });

  it('GET /planner/plans/:planId/targets returns only the targets list', async () => {
    const service = { getPlan: vi.fn().mockResolvedValue(plan('scan-1')) } as unknown as PlannerService;
    const controller = new PlannerController(service);
    const res = makeRes();
    controller.getPlanTargets(
      { params: { planId: 'plan-1' } } as unknown as Request,
      res as unknown as Response,
      vi.fn(),
    );
    await tick();
    const data = res.json.mock.calls[0][0].data;
    expect(data.planId).toBe('plan-1');
    expect(data.targets).toHaveLength(1);
  });

  it('GET /planner/scans/:scanId returns the plan for a scan', async () => {
    const service = { getPlanForScan: vi.fn().mockResolvedValue(plan('scan-1')) } as unknown as PlannerService;
    const controller = new PlannerController(service);
    const res = makeRes();
    controller.getPlanForScan(
      { params: { scanId: 'scan-1' } } as unknown as Request,
      res as unknown as Response,
      vi.fn(),
    );
    await tick();
    expect(res.json.mock.calls[0][0].data.scanId).toBe('scan-1');
  });

  it('GET /planner/scans/:scanId 404s when no plan exists', async () => {
    const service = { getPlanForScan: vi.fn().mockResolvedValue(null) } as unknown as PlannerService;
    const controller = new PlannerController(service);
    const res = makeRes();
    const catcher = nextSpy();
    controller.getPlanForScan(
      { params: { scanId: 'scan-1' } } as unknown as Request,
      res as unknown as Response,
      catcher.next,
    );
    await tick();
    expect(catcher.lastErr()).toBeInstanceOf(Error);
    const err = catcher.lastErr() as { statusCode?: number };
    expect(err.statusCode).toBe(404);
  });
});