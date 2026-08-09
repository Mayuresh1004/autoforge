/**
 * Central HTTP error mapping — integration through the ACTUAL Express
 * route + middleware path (real controllers, real middleware, real HTTP).
 * Asserts the mapping table end to end:
 *   400 malformed request · 404 missing finding · 422 invalid state ·
 *   502 infra/source · 503 sandbox unavailable · 500 masked unexpected.
 * Raw internal error text must never leak into responses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import express, { type Application } from 'express';
import type { AddressInfo } from 'node:net';
import { EngineerController } from '../src/engineer/presentation/controllers/engineer.controller';
import { CriticController } from '../src/critic/presentation/controllers/critic.controller';
import {
  ConfirmedFindingNotFoundError,
  EngineerSourceError,
  UnsupportedVulnerabilityError as EngineerUnsupportedVulnerabilityError,
} from '../src/engineer/domain/errors/engineer.errors';
import {
  InvalidPatchStatusError,
  PatchNotFoundError,
} from '../src/critic/domain/errors/critic.errors';
import { SandboxUnavailableError } from '../src/sniper/domain/errors/sniper.errors';
import { errorHandler, notFoundHandler, UNEXPECTED_ERROR_MESSAGE } from '../src/middlewares/error.middleware';

function throwOnce(fn: () => Error): () => Error {
  let used = false;
  return () => {
    if (!used) {
      used = true;
      return fn();
    }
    return new Error('fallthrough');
  };
}

function buildApp(): Application {
  const app = express();
  app.use(express.json());

  const engineerFailure = throwOnce(() => new ConfirmedFindingNotFoundError('scan-9'));
  const engineer = {
    run: async () => {
      throw engineerFailure();
    },
    getRun: async () => null,
  } as never;
  const engineerController = new EngineerController(engineer);

  const critic = {
    run: async () => {
      throw new InvalidPatchStatusError('patch-7', 'APPROVED');
    },
    getRun: async () => null,
  } as never;
  const criticController = new CriticController(critic);

  app.post('/api/engineer/run', engineerController.run);
  app.get('/api/engineer/:executionId', engineerController.getRun);
  app.post('/api/critic/run', criticController.run);
  app.get('/api/critic/:executionId', criticController.getRun);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('central HTTP error mapping through the real express middleware path', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = buildApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns 400 for a malformed engineer request body', async () => {
    const res = await fetch(`${base}/api/engineer/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scanId: 42 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('maps a confirmed-finding missing error to 404 through the real route', async () => {
    const res = await fetch(`${base}/api/engineer/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scanId: 'scan-9' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FINDING_NOT_FOUND');
  });

  it('maps a critic invalid-patch-state error to 422 with its code', async () => {
    const res = await fetch(`${base}/api/critic/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patchId: 'patch-7' }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_PATCH_STATUS');
  });

  it('maps an unknown engineer execution to 404 through GET', async () => {
    const res = await fetch(`${base}/api/engineer/nope`);
    expect(res.status).toBe(404);
  });

  it('maps unknown critic execution to 404 through GET (side-channel contract)', async () => {
    const res = await fetch(`${base}/api/critic/nope`);
    expect(res.status).toBe(404);
  });

  it('maps unknown routes to 404 via the not-found handler', async () => {
    const res = await fetch(`${base}/api/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('never leaks raw messages for 500s — masks with the safe public message', async () => {
    // Any unhandled error path (plain Error) → 500 INTERNAL_ERROR, masked.
    const { errorStatusForError } = await import('../src/middlewares/error.middleware');
    expect(errorStatusForError(new EngineerSourceError('SOURCE_UNAVAILABLE', 'cat failed'))).toBe(502);
    expect(errorStatusForError(new ConfirmedFindingNotFoundError('x'))).toBe(404);
    expect(errorStatusForError(new EngineerUnsupportedVulnerabilityError('x'))).toBe(422);
    expect(errorStatusForError(new InvalidPatchStatusError('p', 'APPROVED'))).toBe(422);
    expect(errorStatusForError(new PatchNotFoundError('p'))).toBe(404);
    expect(errorStatusForError(new SandboxUnavailableError('sbx'))).toBe(503);
    expect(errorStatusForError(new Error('secret internal detail /Workspace/x'))).toBe(500);

    const app = express();
    app.use(express.json());
    app.post('/boom', (_req, _res) => {
      throw new Error('secret internal detail: /workspace/attack-1673/src/app.py');
    });
    app.use(errorHandler);
    const srv = app.listen(0);
    await new Promise<void>((r) => srv.once('listening', () => r()));
    const { port } = srv.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/boom`, { method: 'POST' });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret internal');
    expect(text).not.toContain('app.py');
    expect(text).toContain(UNEXPECTED_ERROR_MESSAGE);
    await new Promise<void>((r) => srv.close(() => r()));
  });
});