import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { ScanService } from '../../application/services/scan.service';
import type { ScanOverview } from '../../domain/models/scan';
import { ScanController } from './scan.controller';

function makeRes(): { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; payloadPromise: Promise<unknown> } {
  let resolvePayload: (value: unknown) => void = () => undefined;
  const payloadPromise = new Promise<unknown>((resolve) => {
    resolvePayload = resolve;
  });
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    payloadPromise,
  };
  res.status.mockReturnValue(res);
  res.json.mockImplementation((payload: unknown) => {
    resolvePayload(payload);
    return res;
  });
  return res as unknown as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    payloadPromise: Promise<unknown>;
  };
}

describe('ScanController', () => {
  it('POST /scan/static validates the body, runs the scan, and returns a 201 envelope', async () => {
    const service = {
      runStaticScan: vi.fn().mockResolvedValue({ scanId: 'scan_1' }),
    } as unknown as ScanService;
    const controller = new ScanController(service);

    const res = makeRes() as unknown as Response;
    const req = { body: { url: 'https://github.com/owner/repo' } } as unknown as Request;
    controller.createStaticScan(req, res);

    const payload = (await res.payloadPromise) as { success: boolean; data: unknown };
    expect(service.runStaticScan).toHaveBeenCalledWith('https://github.com/owner/repo');
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual({ scanId: 'scan_1' });
  });

  it('rejects a malformed static-scan body with a 400 and no service call', async () => {
    const service = { runStaticScan: vi.fn() } as unknown as ScanService;
    const controller = new ScanController(service);

    let caught: unknown;
    const next: NextFunction = (err?: unknown) => {
      caught = err;
      return undefined;
    };
    const req = { body: { wrong: 'field' } } as unknown as Request;
    const res = { json: () => undefined as unknown } as unknown as Response;
    controller.createStaticScan(req, res, next);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.runStaticScan).not.toHaveBeenCalled();
    expect((caught as { statusCode: number }).statusCode).toBe(400);
  });

  it('GET /scan/:id returns an overview or a 404', async () => {
    const overview = { scanId: 'scan_1' } as unknown as ScanOverview;
    const service = { getScanOverview: vi.fn().mockResolvedValue(overview) } as unknown as ScanService;
    const controller = new ScanController(service);

    const res = makeRes() as unknown as Response;
    const req = { params: { id: 'scan_1' } } as unknown as Request;
    controller.getScan(req, res);
    const payload = (await res.payloadPromise) as { data: ScanOverview; error: unknown };
    expect(payload.data).toBe(overview);
    expect(payload.error).toBeNull();

    let caught: unknown;
    const next: NextFunction = (err?: unknown) => {
      caught = err;
      return undefined;
    };
    service.getScanOverview = vi.fn().mockResolvedValue(null) as never;
    controller.getScan(req, res, next);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((caught as { statusCode: number }).statusCode).toBe(404);
  });
});