import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ValidationError } from '../../../utils/errors';
import { EngineerController } from './engineer.controller';
import { ConfirmedFindingNotFoundError } from '../../domain/errors/engineer.errors';
import type { EngineerRunResult, EngineerService } from '../../application/services/engineer.service';


function okRun(): EngineerRunResult {
  return {
    executionId: 'exec-1',
    vulnerabilityId: 'vuln-1',
    patchId: 'patch-1',
    status: 'GENERATED',
    summary: { sourceLines: 12, ragDocs: 3, reviewPassed: true, model: 'fake/free', diffChars: 420, reason: null },
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

describe('engineer controller', () => {
  it('POST /run: validation error for a missing scanId', async () => {
    const engineer = { run: vi.fn(), getRun: vi.fn() } as unknown as EngineerService;
    const controller = new EngineerController(engineer);
    const res = makeRes();
    await expect(invoke(controller.run, { body: {} }, res)).rejects.toBeInstanceOf(ValidationError);
    await expect(invoke(controller.run, { body: { scanId: '' } }, res)).rejects.toBeInstanceOf(ValidationError);
    await expect(invoke(controller.run, { body: { scanId: 5 } }, res)).rejects.toBeInstanceOf(ValidationError);
    expect(engineer.run).not.toHaveBeenCalled();
  });

  it('POST /run: delegates and returns 200 + run result', async () => {
    const engineer = { run: vi.fn(async () => okRun()), getRun: vi.fn() } as unknown as EngineerService;
    const controller = new EngineerController(engineer);
    const res = makeRes();
    await invoke(controller.run, { body: { scanId: 'scan-1' } }, res);
    expect(res.statusCode).toBe(200);
    const data = (res.body as { data: EngineerRunResult }).data;
    expect(data.executionId).toBe('exec-1');
    expect(data.status).toBe('GENERATED');
    expect(engineer.run).toHaveBeenCalledWith({ scanId: 'scan-1' });
  });

  it('POST /run: forwards an optional vulnerabilityId', async () => {
    const engineer = { run: vi.fn(async () => okRun()), getRun: vi.fn() } as unknown as EngineerService;
    const controller = new EngineerController(engineer);
    const res = makeRes();
    await invoke(controller.run, { body: { scanId: 'scan-1', vulnerabilityId: 'vuln-9' } }, res);
    expect(engineer.run).toHaveBeenCalledWith({ scanId: 'scan-1', vulnerabilityId: 'vuln-9' });
  });

  it('POST /run: finding-not-found surfaces as a 404 via next', async () => {
    const engineer = {
      run: vi.fn(async () => { throw new ConfirmedFindingNotFoundError('scan-1'); }),
      getRun: vi.fn(),
    } as unknown as EngineerService;
    const controller = new EngineerController(engineer);
    const res = makeRes();
    await expect(invoke(controller.run, { body: { scanId: 'scan-1' } }, res)).rejects.toBeInstanceOf(ConfirmedFindingNotFoundError);
  });

  it('GET /:executionId: errors with FINDING_NOT_FOUND when the execution is unknown', async () => {
    const engineer = { run: vi.fn(), getRun: vi.fn(async () => null) } as unknown as EngineerService;
    const controller = new EngineerController(engineer);
    const res = makeRes();
    await expect(
      invoke(controller.getRun, { params: { executionId: 'nope' } }, res),
    ).rejects.toMatchObject({ code: 'FINDING_NOT_FOUND' });
  });

  it('GET /:executionId: 200 with the execution detail', async () => {
    const engineer = {
      run: vi.fn(),
      getRun: vi.fn(async () => ({
        id: 'exec-1', scanId: 'scan-1', agentType: 'ENGINEER', status: 'COMPLETED',
        createdAt: new Date().toISOString(),
        inputMetadata: { scanId: 'scan-1' },
        outputMetadata: { status: 'GENERATED', patchId: 'patch-1' },
      })),
    } as unknown as EngineerService;
    const controller = new EngineerController(engineer);
    const res = makeRes();
    await invoke(controller.getRun, { params: { executionId: 'exec-1' } }, res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { data: { agentType: string } }).data.agentType).toBe('ENGINEER');
  });

});