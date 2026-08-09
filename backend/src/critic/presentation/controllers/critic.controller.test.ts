/**
 * Critic controller — transports only; error→HTTP mapping is deterministic.
 * The route file is NOT mounted in routes/index.ts (hidden side-channel).
 */

import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ValidationError } from '../../../utils/errors';
import { CriticController } from './critic.controller';
import type { CriticRunResult, CriticService } from '../../application/services/critic.service';
import {
  InvalidPatchStatusError,
  PatchConflictError,
  PatchNotFoundError,
  UnsupportedVulnerabilityError,
} from '../../domain/errors/critic.errors';

function okRun(): CriticRunResult {
  return {
    id: 'patch-1#1',
    patchId: 'patch-1',
    vulnerabilityId: 'vuln-1',
    scanId: 'scan-1',
    executionId: 'critic-exec-1',
    attempt: 1,
    status: 'APPROVED',
    failureKind: null,
    errorMessage: null,
    checks: [],
    exploit: null,
    feedback: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:00.100Z',
  };
}

function makeRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    json: vi.fn((value: unknown) => {
      res.body = value;
      return res;
    }),
    status: vi.fn(function (this: unknown, code: number) {
      (this as { statusCode: number }).statusCode = code;
      return res;
    }),
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

function invoke(
  handler: (req: Request, res: Response, next: NextFunction) => void,
  req: Partial<Request>,
  res: ReturnType<typeof makeRes>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    handler(req as Request, res as unknown as Response, finish);
    setTimeout(() => finish(), 0);
  });
}

describe('critic controller', () => {
  it('POST /run: validation error for a missing/invalid patchId', async () => {
    const critic = { run: vi.fn(), getRun: vi.fn() } as unknown as CriticService;
    const controller = new CriticController(critic);
    const res = makeRes();
    await expect(invoke(controller.run, { body: {} }, res)).rejects.toBeInstanceOf(ValidationError);
    await expect(invoke(controller.run, { body: { patchId: '' } }, res)).rejects.toBeInstanceOf(ValidationError);
    await expect(invoke(controller.run, { body: { patchId: 5 } }, res)).rejects.toBeInstanceOf(ValidationError);
    expect(critic.run).not.toHaveBeenCalled();
  });

  it('POST /run: attempt bounds are validated (1..10)', async () => {
    const critic = { run: vi.fn(async () => okRun()), getRun: vi.fn() } as unknown as CriticService;
    const controller = new CriticController(critic);
    const res = makeRes();
    await expect(invoke(controller.run, { body: { patchId: 'p', attempt: 0 } }, res)).rejects.toBeInstanceOf(ValidationError);
    await expect(invoke(controller.run, { body: { patchId: 'p', attempt: 11 } }, res)).rejects.toBeInstanceOf(ValidationError);
    expect(critic.run).not.toHaveBeenCalled();
  });

  it('POST /run: delegates and returns 200 + run result', async () => {
    const run = vi.fn(async () => okRun());
    const critic = { run, getRun: vi.fn() } as unknown as CriticService;
    const controller = new CriticController(critic);
    const res = makeRes();
    await invoke(controller.run, { body: { patchId: 'patch-1' } }, res);
    expect(res.statusCode).toBe(200);
    const data = (res.body as { data: { status: string } }).data;
    expect(data.status).toBe('APPROVED');
    expect(critic.run).toHaveBeenCalledWith({ patchId: 'patch-1' });
  });

  it('GET /:executionId: 404 for an unknown run', async () => {
    const critic = { run: vi.fn(), getRun: vi.fn(async () => null) } as unknown as CriticService;
    const controller = new CriticController(critic);
    const res = makeRes();
    await expect(invoke(controller.getRun, { params: { executionId: 'nope' } }, res)).rejects.toMatchObject({
      code: 'PATCH_NOT_FOUND',
    });
  });

  it('GET /:executionId: 200 with the run detail', async () => {
    const critic = {
      run: vi.fn(),
      getRun: vi.fn(async () => okRun()),
    } as unknown as CriticService;
    const controller = new CriticController(critic);
    const res = makeRes();
    await invoke(controller.getRun, { params: { executionId: 'critic-exec-1' } }, res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { data: { patchId: string } }).data.patchId).toBe('patch-1');
  });

});