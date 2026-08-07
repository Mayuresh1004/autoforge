import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { RepositoryProfile } from '../../domain/models/repository-profile';
import type { RepositoryProfileService } from '../../application/services/repository-profile.service';
import { RepositoryProfileController } from './repository-profile.controller';

function makeRes(): { json: ReturnType<typeof vi.fn>; payloadPromise: Promise<unknown> } {
  let resolvePayload: (value: unknown) => void = () => undefined;
  const payloadPromise = new Promise<unknown>((resolve) => {
    resolvePayload = resolve;
  });
  const json = vi.fn((payload: unknown) => {
    resolvePayload(payload);
    return makeRes;
  });
  return { json, payloadPromise };
}

function makeServiceStub(profile?: RepositoryProfile): {
  analyzeRepository: ReturnType<typeof vi.fn>;
} {
  return {
    analyzeRepository: vi.fn().mockResolvedValue(profile),
  };
}

describe('RepositoryProfileController', () => {
  it('validates the body, analyzes, and returns the profile in a success envelope', async () => {
    const profile = { meta: { name: 'repo' } } as RepositoryProfile;
    const service = makeServiceStub(profile);
    const controller = new RepositoryProfileController(service as unknown as RepositoryProfileService);

    const res = makeRes();
    const req = { body: { url: 'https://github.com/owner/repo' } } as unknown as Request;
    controller.analyze(req, res as unknown as Response);

    const payload = await res.payloadPromise;
    expect(service.analyzeRepository).toHaveBeenCalledWith('https://github.com/owner/repo');
    const envelope = payload as { success: boolean; data: unknown; error: unknown };
    expect(envelope.success).toBe(true);
    expect(envelope.data).toBe(profile);
    expect(envelope.error).toBeNull();
  });

  it('rejects a malformed body with a validation error (no service call)', async () => {
    const service = makeServiceStub({} as RepositoryProfile);
    const controller = new RepositoryProfileController(service as unknown as RepositoryProfileService);

    let caught: unknown;
    const next: NextFunction = (err?: unknown) => {
      caught = err;
      return undefined;
    };

    const req = { body: { wrong: 'field' } } as unknown as Request;
    const res = { json: () => undefined as unknown } as unknown as Response;
    controller.analyze(req, res, next);

    // The asyncHandler forwards rejections to next(); await a microtask.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.analyzeRepository).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { statusCode: number }).statusCode).toBe(400);
  });
});