/**
 * GET /api/scans/:scanId/events — the frontend-consumable SSE stream.
 *
 *  - scan existence is validated BEFORE any streaming starts (404 via the
 *    central error mapping — raw events for arbitrary scan ids are never
 *    exposed);
 *  - per-scan subscription only (a connection never sees another scan's
 *    events — the bus keys subscriptions by scanId);
 *  - heartbeat comments keep proxies from timing the connection out;
 *  - Last-Event-ID: on connect the tail of the bounded in-memory ring is
 *    replayed (sequence > last id), so short reconnects resume seamlessly;
 *  - a bounded per-connection buffer protects the scan from slow clients:
 *    an overflowing connection is closed, never blocking publish;
 *  - connection cleanup: unsubscribe + interval cleared on close/error;
 *  - the internal EventBus object is never exposed — only the stream.
 */

import type { Request, Response, NextFunction } from 'express';
import type { EventBus } from '../../domain/ports/event-bus';
import { ScanNotFoundError } from '../../../planner/domain/errors/planner.errors';
import { formatSseFrame, sseHeartbeatLine, sseRetryLine, BoundedSseBuffer } from '../../infrastructure/sse/event-stream';

export interface EventsControllerDeps {
  readonly bus: EventBus;
  /** Scan-existence gate (Prisma-backed in production; fakes in tests). */
  readonly scanExists: (scanId: string) => Promise<boolean>;
  readonly heartbeatMs?: number;
  readonly sseBufferLines?: number;
}

const MAX_LAST_EVENT_ID = 1_000_000;

export class EventsController {
  private readonly bus: EventBus;
  private readonly scanExists: (scanId: string) => Promise<boolean>;
  private readonly heartbeatMs: number;
  private readonly sseBufferLines: number;

  constructor(deps: EventsControllerDeps) {
    this.bus = deps.bus;
    this.scanExists = deps.scanExists;
    this.heartbeatMs = deps.heartbeatMs ?? 15_000;
    this.sseBufferLines = deps.sseBufferLines ?? 200;
  }

  stream = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const scanId = (req.params.scanId as string | undefined)?.trim() ?? '';
    if (!scanId) throw new ScanNotFoundError(scanId);
    // Gate BEFORE any SSE handshake — the error middleware renders 404.
    if (!(await this.scanExists(scanId))) throw new ScanNotFoundError(scanId);

    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    res.write(sseRetryLine(this.heartbeatMs));

    // Reconnect support: replay the bounded tail after Last-Event-ID.
    const lastEventId = parseLastEventId(req.headers['last-event-id']);
    for (const event of this.bus.replay(scanId, lastEventId)) {
      res.write(formatSseFrame(event));
    }

    const buffer = new BoundedSseBuffer(this.sseBufferLines);
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };

    const unsubscribe = this.bus.subscribe(scanId, (event) => {
      if (closed) return;
      if (!buffer.push(formatSseFrame(event))) {
        // Slow client — drop the connection rather than stall the scan.
        close();
        return;
      }
      flush();
    });

    const flush = (): void => {
      if (closed) return;
      const chunk = buffer.drain();
      if (chunk) res.write(chunk);
    };

    const heartbeat = setInterval(() => {
      if (closed) return;
      res.write(sseHeartbeatLine());
    }, this.heartbeatMs);
    heartbeat.unref?.();

    req.on('close', close);
    req.on('error', close);
    res.on('close', close);
  };
}

function parseLastEventId(raw: unknown): number {
  if (typeof raw !== 'string') return 0;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, MAX_LAST_EVENT_ID);
}