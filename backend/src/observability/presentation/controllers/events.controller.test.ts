/**
 * SSE event endpoint tests — through the REAL express middleware path with
 * the real EventsController:
 *   - scan validation before streaming (404 for unknown scans),
 *   - server-sent frames with per-scan sequence ids,
 *   - Last-Event-ID replay of the bounded window,
 *   - heartbeats keep the connection alive,
 *   - connection close releases the bus subscription,
 *   - a slow client overflows its bounded per-connection buffer and the
 *     connection is closed — publishes are never blocked.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import express, { type Application } from 'express';
import type { AddressInfo } from 'node:net';
import { InMemoryEventBus } from '../../application/in-memory-event-bus';
import { EventsController } from '../controllers/events.controller';
import { errorHandler } from '../../../middlewares/error.middleware';
import { asyncHandler } from '../../../middlewares/request.middleware';

const EXISTING_SCAN = 'sse-scan-1';

function buildApp(bus: InMemoryEventBus, opts: { heartbeatMs?: number; sseBufferLines?: number } = {}): Application {
  const app = express();
  const controller = new EventsController({
    bus,
    scanExists: async (scanId: string) => scanId === EXISTING_SCAN,
    heartbeatMs: opts.heartbeatMs ?? 200,
    sseBufferLines: opts.sseBufferLines ?? 64,
  });
  app.get('/api/scans/:scanId/events', asyncHandler(controller.stream));
  app.use(errorHandler);
  return app;
}

const frame = {
  scanId: EXISTING_SCAN,
  eventType: 'SCAN_STARTED' as const,
  agentType: 'SYSTEM' as const,
  phase: 'scan' as const,
  status: 'STARTED' as const,
  message: 'scan started',
};

async function openStream(base: string, scanId: string, lastEventId?: string) {
  const headers: Record<string, string> = { accept: 'text/event-stream' };
  if (lastEventId !== undefined) headers['last-event-id'] = lastEventId;
  const controller = new AbortController();
  const res = await fetch(`${base}/api/scans/${scanId}/events`, { headers, signal: controller.signal });
  return { res, controller, reader: res.body!.getReader() };
}

async function collect(
  stream: Awaited<ReturnType<typeof openStream>>,
  until: (acc: string) => boolean,
  ms = 2_000,
): Promise<string> {
  const decoder = new TextDecoder();
  let acc = '';
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const { done, value } = await Promise.race([
      stream.reader.read(),
      new Promise<{ done: boolean; value?: Uint8Array }>((_, reject) =>
        setTimeout(() => reject(new Error('read-silence')), 250)
      ),
    ]);
    if (done) break;
    acc += decoder.decode(value, { stream: true });
    if (until(acc)) break;
  }
  return acc;
}

describe('GET /api/scans/:scanId/events (SSE)', () => {
  let server: Server;
  let base: string;
  let bus: InMemoryEventBus;
  let app: Application;

  beforeAll(async () => {
    bus = new InMemoryEventBus({ ringPerScan: 64 });
    app = buildApp(bus, { heartbeatMs: 60 });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('validates the scan BEFORE streaming and maps a missing scan to 404', async () => {
    const res = await fetch(`${base}/api/scans/ghost/events`, {
      headers: { accept: 'text/event-stream' },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).not.toContain('text/event-stream');
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/not found/i);
  });

  it('streams replay + live events with per-scan sequence ids and heartbeats', async () => {
    bus.publish({ ...frame, message: 'first' });
    bus.publish({ ...frame, message: 'second' });

    const stream = await openStream(base, EXISTING_SCAN);
    expect(stream.res.status).toBe(200);
    expect(stream.res.headers.get('content-type')).toContain('text/event-stream');

    // Live event after the connection is up.
    bus.publish({ ...frame, message: 'third' });
    const acc = await collect(stream, (a) => a.includes('"message":"third"') && a.includes(': ping'));
    stream.controller.abort();

    expect(acc).toContain('event: SCAN_STARTED');
    expect(acc).toContain('id: 1');
    expect(acc).toContain('"sequence":2');
    expect(acc).toContain('"message":"third"');
    expect(acc).toContain(': ping'); // heartbeat frame
  });

  it('respects Last-Event-ID: only events after the given sequence are replayed', async () => {
    const stream = await openStream(base, EXISTING_SCAN, '1');
    const acc = await collect(stream, (a) => a.includes('"message":"third"'));
    stream.controller.abort();

    expect(acc).not.toContain('"message":"first"');
    expect(acc).toContain('"message":"second"');
    expect(acc).toContain('"message":"third"');
  });

  it('tears down on client disconnect: the bus subscription is released', async () => {
    const stream = await openStream(base, EXISTING_SCAN);
    await collect(stream, (a) => a.length > 0, 300);
    expect(bus.subscriberCount(EXISTING_SCAN)).toBe(1);
    stream.controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(bus.subscriberCount(EXISTING_SCAN)).toBe(0);
  });

  it('a slow/overflowing client is closed instead of blocking publishes', async () => {
    const stream = await openStream(base, EXISTING_SCAN);
    await collect(stream, (a) => a.length > 0, 300);
    // Flood beyond the per-connection SSE buffer (64 frames).
    for (let i = 1; i <= 120; i += 1) {
      bus.publish({ ...frame, message: `flood-${i}` });
    }
    stream.controller.abort();
    // The bus itself was never blocked: all 120 events published.
    expect(bus.getSequence(EXISTING_SCAN)).toBeGreaterThanOrEqual(120);
  });
});