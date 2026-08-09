/**
 * SSE serialization + bounded per-connection buffering — transport-agnostic
 * building blocks for the events endpoint. No Express types here; the
 * controller adapts them to `ServerResponse`.
 */

import type { AmassEvent } from '../../domain/events/amass-event';

/** Serialize one canonical event as an SSE frame. `id` is the per-scan
 *  monotonic sequence (reconnect/Last-Event-ID replay), `event` the bounded
 *  type, `data` the full event JSON. */
export function formatSseFrame(event: AmassEvent): string {
  return `event: ${event.eventType}\nid: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function sseHeartbeatLine(): string {
  return ': ping\n\n';
}

export function sseRetryLine(ms: number): string {
  return `retry: ${Math.max(250, Math.floor(ms))}\n`;
}

/**
 * Bounded per-connection FIFO. `push` never blocks; when the buffer is full
 * (a slow client), `push` returns `false` and the connection is dropped by
 * the caller — the scan is never slowed or blocked by one SSE client.
 */
export class BoundedSseBuffer {
  private readonly lines: string[] = [];

  constructor(private readonly maxLines: number) {}

  push(line: string): boolean {
    if (this.lines.length >= this.maxLines) return false;
    this.lines.push(line);
    return true;
  }

  /** Drain and return the concatenated pending frames (may be ''). */
  drain(): string {
    if (this.lines.length === 0) return '';
    const out = this.lines.join('');
    this.lines.length = 0;
    return out;
  }

  get size(): number {
    return this.lines.length;
  }
}