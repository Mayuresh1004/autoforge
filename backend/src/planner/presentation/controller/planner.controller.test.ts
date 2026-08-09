import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { PlannerController } from './planner.controller';
import type { PlannerService } from '../../domain/ports/planner';
import type { AttackPlan } from '../../domain/models/plan';
import { toPlanResponse } from '../dto/planner.dto';

function nextSpy(): { next: NextFunction; lastErr: () => unknown } {
  const errors: unknown[] = [];
  const next: NextFunction = (err?: unknown) => {
    if (err) errors.push(err);
  };
  return { next, lastErr: () => errors[errors.length - 1] };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function plan(overrides: Partial<AttackPlan> = {}): AttackPlan {
  return {
    id: 'plan-1',
    scanId: 'scan-1',
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
    ...overrides,
  };
}

describe('PlannerController', () => {
  it('POST /planner/run returns 201 with a serialized plan response', async () => {
    const service = { generate: vi.fn().mockResolvedValue(plan()) } as unknown as PlannerService;
    const controller = new PlannerController(service);
    const response = toPlanResponse(plan());
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnValue(response) } as unknown as Response;
    controller.run({ body: { scanId: 'scan-1' } } as Request, res, vi.fn());
    await tick();
    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(201);
    expect(response.targets[0].recommendedTool).toBe('sqlmap');
  });

  it('GET /planner/plans/:planId returns serialized plan targets', async () => {
    const service = { getPlan: vi.fn().mockResolvedValue(plan()) } as unknown as PlannerService;
    const controller = new PlannerController(service);
    const response = toPlanResponse(plan());
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnValue(response) } as unknown as Response;
    controller.getPlan({ params: { planId: 'plan-1' } } as unknown as Request, res, vi.fn());
    await tick();
    expect(response.targets).toHaveLength(1);
  });

  it('GET /planner/plans/:planId/targets returns only the targets list', async () => {
    const service = { getPlan: vi.fn().mockResolvedValue(plan()) } as unknown as PlannerService;
    const controller = new PlannerController(service);
    const response = toPlanResponse(plan());
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnValue(response) } as unknown as Response;
    controller.getPlanTargets({ params: { planId: 'plan-1' } } as unknown as Request, res, vi.fn());
    await tick();
    expect(response.targets[0].targetId).toBe('t-1');
  });

  it('GET /planner/scans/:scanId returns the plan for a scan', async () => {
    const service = { getPlanForScan: vi.fn().mockResolvedValue(plan()) } as unknown as PlannerService;
    const controller = new PlannerController(service);
    const response = toPlanResponse(plan());
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnValue(response) } as unknown as Response;
    controller.getPlanForScan({ params: { scanId: 'scan-1' } } as unknown as Request, res, vi.fn());
    await tick();
    expect(response.scanId).toBe('scan-1');
  });

  it('GET /planner/scans/:scanId 404s when no plan exists', async () => {
    const service = { getPlanForScan: vi.fn().mockResolvedValue(null) } as unknown as PlannerService;
    const controller = new PlannerController(service);
    const catcher = nextSpy();
    controller.getPlanForScan({ params: { scanId: 'scan-1' } } as unknown as Request, {} as Response, catcher.next);
    await tick();
    expect(catcher.lastErr()).toBeInstanceOf(Error);
    const err = catcher.lastErr() as { statusCode?: number };
    expect(err.statusCode).toBe(404);
  });
});
