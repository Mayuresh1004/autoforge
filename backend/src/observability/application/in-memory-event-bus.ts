/**
 * InMemoryEventBus — the application's typed, ephemeral event bus.
 *
 * Guarantees:
 *  - per-scan MONOTONIC `sequence` (the only ordering key);
 *  - closed event-type union enforced at runtime;
 *  - bounded memory: a ring per scan (cap `ringPerScan`) and a cap on the
 *    number of tracked scans (LRU-evicted by last publish);
 *  - publish NEVER throws for subscriber problems and never awaits a
 *    subscriber, so a slow SSE client can never block a scan (the SSE layer
 *    applies its own bounded per-connection queue);
 *  - secret redaction + truncation of message and metadata string values
 *    (reuses the LLM redactor — no new redaction system), and a hard byte
 *    cap on the serialized metadata payload;
 *  - agents only ever receive the narrowed `AmassEventPublisher`, so a
 *    component cannot read another scan's events by construction.
 *
 * Persistence: none. Ephemeral by design for this phase (see
 * `src/observability/domain/events/amass-event.ts`).
 */

import { randomUUID } from 'node:crypto';
import { redactSensitive } from '../../llm/infrastructure/redact/redactor';
import { logger } from '../../config/logger';
import type {
  AmassEvent,
  AmassEventCounts,
  AmassEventMetadata,
  AmassMetadataValue,
} from '../domain/events/amass-event';
import { isAmassEventType, AMASS_EVENT_ID_PREFIX } from '../domain/events/amass-event';
import type { AmassEventInput, AmassEventSubscriber, EventBus } from '../domain/ports/event-bus';
import { InvalidAmassEventError } from '../domain/ports/event-bus';

export interface InMemoryEventBusOptions {
  readonly ringPerScan?: number;
  readonly maxScans?: number;
  readonly messageMaxChars?: number;
  readonly metadataMaxBytes?: number;
  /** Now injectable for deterministic tests. */
  readonly now?: () => Date;
}

const MAX_SCAN_ID_CHARS = 64;
const MAX_METADATA_DEPTH = 2;
const MAX_STRING_VALUE_CHARS = 240;

export class InMemoryEventBus implements EventBus {
  private readonly ringPerScan: number;
  private readonly maxScans: number;
  private readonly messageMaxChars: number;
  private readonly metadataMaxBytes: number;
  private readonly now: () => Date;

  private readonly sequences = new Map<string, number>();
  private readonly rings = new Map<string, AmassEvent[]>();
  private readonly subscribers = new Map<string, Set<AmassEventSubscriber>>();
  /** scanId -> last-publish epoch (for bounded-scan LRU eviction). */
  private readonly touched = new Map<string, number>();
  private readonly counts = new Map<string, number>();

  constructor(options: InMemoryEventBusOptions = {}) {
    this.ringPerScan = options.ringPerScan ?? 200;
    this.maxScans = options.maxScans ?? 100;
    this.messageMaxChars = options.messageMaxChars ?? 300;
    this.metadataMaxBytes = options.metadataMaxBytes ?? 2_048;
    this.now = options.now ?? (() => new Date());
  }

  publish(input: AmassEventInput): void {
    if (!isAmassEventType(input.eventType)) {
      throw new InvalidAmassEventError(`unknown eventType '${String(input.eventType)}'`);
    }
    const scanId = this.boundScanId(input.scanId);
    if (this.sequences.size >= this.maxScans && !this.sequences.has(scanId)) {
      this.evictLeastRecentlyPublished();
    }

    const sequence = (this.sequences.get(scanId) ?? 0) + 1;
    this.sequences.set(scanId, sequence);

    const event: AmassEvent = {
      eventId: `${AMASS_EVENT_ID_PREFIX}_${randomUUID().slice(0, 12)}`,
      scanId,
      sequence,
      timestamp: this.now().toISOString(),
      eventType: input.eventType,
      agentType: input.agentType,
      phase: input.phase,
      level: input.level ?? 'INFO',
      status: input.status,
      message: this.sanitizeMessage(input.message),
      metadata: this.sanitizeMetadata(input.metadata),
    };

    this.ringPush(scanId, event);
    this.touched.set(scanId, Date.now());
    this.notify(scanId, event);
  }

  subscribe(scanId: string, subscriber: AmassEventSubscriber): () => void {
    const key = this.boundScanId(scanId);
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(subscriber);
    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(key);
    };
  }

  subscriberCount(scanId: string): number {
    return this.subscribers.get(this.boundScanId(scanId))?.size ?? 0;
  }

  replay(scanId: string, afterSequence: number): readonly AmassEvent[] {
    const key = this.boundScanId(scanId);
    const ring = this.rings.get(key);
    if (!ring) return [];
    const after = Math.max(0, Math.floor(afterSequence));
    return ring.filter((event) => event.sequence > after);
  }

  getSequence(scanId: string): number {
    return this.sequences.get(this.boundScanId(scanId)) ?? 0;
  }

  release(scanId: string): void {
    const key = this.boundScanId(scanId);
    this.sequences.delete(key);
    this.rings.delete(key);
    this.subscribers.delete(key);
    this.touched.delete(key);
    this.counts.delete(key);
  }

  /** Publish counter for diagnostics/tests (events published per scan). */
  publishedCount(scanId: string): number {
    return this.counts.get(this.boundScanId(scanId)) ?? 0;
  }

  private boundScanId(scanId: string): string {
    const trimmed = (scanId ?? '').trim();
    if (!trimmed) throw new InvalidAmassEventError('scanId is required');
    return trimmed.length > MAX_SCAN_ID_CHARS ? trimmed.slice(0, MAX_SCAN_ID_CHARS) : trimmed;
  }

  private sanitizeMessage(message: string): string {
    const redacted = redactSensitive(String(message ?? ''));
    return redacted.length > this.messageMaxChars
      ? `${redacted.slice(0, this.messageMaxChars)}…[+${redacted.length - this.messageMaxChars} chars]`
      : redacted;
  }

  private sanitizeMetadata(metadata: AmassEventMetadata | undefined): AmassEventMetadata | undefined {
    if (!metadata || Object.keys(metadata).length === 0) return undefined;
    const sanitized = this.sanitizeNode(metadata, 0) as AmassEventMetadata | null;
    if (!sanitized || Object.keys(sanitized).length === 0) return undefined;
    let payloadBytes = 0;
    try {
      payloadBytes = Buffer.byteLength(JSON.stringify(sanitized), 'utf8');
    } catch {
      return undefined;
    }
    if (payloadBytes > this.metadataMaxBytes) {
      logger.warn({ bytes: payloadBytes, cap: this.metadataMaxBytes }, 'events.metadata: dropped over-cap payload');
      return undefined;
    }
    return sanitized;
  }

  /** Redact + truncate primitives and flat counts; drop over-deep nodes. */
  private sanitizeNode(
    node: AmassEventMetadata | AmassEventCounts,
    depth: number,
  ): AmassEventMetadata | AmassEventCounts | null {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (value === undefined || value === null) continue;
      const normalized = this.sanitizeValue(key, value, depth);
      if (normalized !== undefined) out[key] = normalized;
    }
    return Object.keys(out).length > 0 ? (out as AmassEventMetadata) : null;
  }

  private sanitizeValue(key: string, value: unknown, depth: number): AmassMetadataValue | AmassEventCounts | undefined {
    if (typeof value === 'string') {
      const redacted = redactSensitive(value);
      return redacted.length > MAX_STRING_VALUE_CHARS ? `${redacted.slice(0, MAX_STRING_VALUE_CHARS)}…` : redacted;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'object' && value !== null) {
      if (depth >= MAX_METADATA_DEPTH) return undefined; // bounded depth — drop
      const counts = value as AmassEventCounts;
      const flatCounts = Object.entries(counts).every(([k, v]) => typeof k === 'string' && typeof v === 'number');
      if (flatCounts && Object.keys(counts).length > 0) {
        return this.sanitizeNode(counts, depth + 1) as AmassEventCounts;
      }
      return undefined; // no nested arbitrary objects
    }
    return undefined;
  }

  private ringPush(scanId: string, event: AmassEvent): void {
    let ring = this.rings.get(scanId);
    if (!ring) {
      ring = [];
      this.rings.set(scanId, ring);
    }
    ring.push(event);
    while (ring.length > this.ringPerScan) ring.shift();
  }

  private notify(scanId: string, event: AmassEvent): void {
    this.counts.set(scanId, (this.counts.get(scanId) ?? 0) + 1);
    const set = this.subscribers.get(scanId);
    if (!set || set.size === 0) return;
    for (const subscriber of [...set]) {
      try {
        subscriber(event);
      } catch (error) {
        // A subscriber must never break publish or the scan flow.
        logger.warn({ scanId, err: error }, 'events.subscriber: ignored failure');
      }
    }
  }

  private evictLeastRecentlyPublished(): void {
    let oldest: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [scanId, at] of this.touched) {
      if (at < oldestAt) {
        oldestAt = at;
        oldest = scanId;
      }
    }
    if (oldest) this.release(oldest);
  }
}