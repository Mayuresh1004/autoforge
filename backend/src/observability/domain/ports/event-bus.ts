/**
 * EventBus ports — infrastructure-independent (no Express/SSE/Prisma/Docker).
 *
 *  - `AmassEventPublisher` is the ONLY surface agents see: they may publish
 *    canonical events but can never subscribe to or replay another scan's
 *    stream (no cross-scan leakage by construction, and the bus internals
 *    are never exposed through the HTTP layer).
 *  - `EventBus` is the application-owned bus used by the composition root
 *    and the SSE endpoint (subscribe / replay / release). Nothing in the
 *    `observability` module depends on a transport.
 */

import type { AmassEvent } from '../events/amass-event';
import type { AmassEventLevel, AmassEventMetadata, AmassEventStatus, AmassEventType, AmassAgentType, AmassPhase } from '../events/amass-event';

/** Agent-side event input. `eventId`/`sequence`/`timestamp` are assigned by
 *  the bus; `eventType`, `phase` and `status` are required and bounded. */
export interface AmassEventInput {
  readonly scanId: string;
  readonly eventType: AmassEventType;
  readonly agentType?: AmassAgentType;
  readonly phase: AmassPhase;
  readonly level?: AmassEventLevel;
  readonly status: AmassEventStatus;
  readonly message: string;
  readonly metadata?: AmassEventMetadata;
}

export type AmassEventSubscriber = (event: AmassEvent) => void;

/** Narrow agent-facing publisher port. */
export interface AmassEventPublisher {
  publish(input: AmassEventInput): void;
}

/** Application-owned bus: publish + per-scan subscribe/replay/release. */
export interface EventBus extends AmassEventPublisher {
  /**
   * Subscribe to events for ONE scan. Returns an unsubscribe thunk.
   * Subscribers are invoked synchronously; a throwing subscriber is
   * tolerated (never breaks publish) and never blocks the scan.
   */
  subscribe(scanId: string, subscriber: AmassEventSubscriber): () => void;

  /** Number of subscribers for a scan (tests + diagnostics). */
  subscriberCount(scanId: string): number;

  /**
   * Bounded in-memory replay: events for `scanId` with
   * `sequence > afterSequence` (the SSE Last-Event-ID path), oldest first.
   * Empty when the ring already evicted the requested window.
   */
  replay(scanId: string, afterSequence: number): readonly AmassEvent[];

  /** Current sequence high-water mark for `scanId` (0 when never seen). */
  getSequence(scanId: string): number;

  /** Drop a scan's buffers and subscribers (bounded-memory control). */
  release(scanId: string): void;
}

/** Errors surfaced by a bus at publish time (programming errors only —
 *  agents publish valid typed inputs; a bad input throws immediately). */
export class InvalidAmassEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAmassEventError';
  }
}