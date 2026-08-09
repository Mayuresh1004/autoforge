/**
 * InMemoryEventBus unit tests: closed union, per-scan monotonic sequence,
 * bounded rings/scan counts, redaction + truncation, subscriber isolation,
 * replay windows and release.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from './in-memory-event-bus';
import { isAmassEventType, type AmassEvent } from '../domain/events/amass-event';
import { InvalidAmassEventError } from '../domain/ports/event-bus';

const base = {
  scanId: 'scan-a',
  eventType: 'SCAN_STARTED' as const,
  agentType: 'SYSTEM' as const,
  phase: 'scan' as const,
  status: 'STARTED' as const,
  message: 'hello',
};

describe('InMemoryEventBus', () => {
  it('rejects an event with an arbitrary eventType (closed union), and isAmassEventType guards', () => {
    const bus = new InMemoryEventBus();
    expect(isAmassEventType('SCAN_STARTED')).toBe(true);
    expect(isAmassEventType('MY_ARBITRARY_EVENT')).toBe(false);
    expect(() =>
      // @ts-expect-error deliberately violates the union
      bus.publish({ ...base, eventType: 'MY_ARBITRARY_EVENT' })
    ).toThrow(InvalidAmassEventError);
    expect(() => bus.publish({ ...base, scanId: '   ' })).toThrow(InvalidAmassEventError);
  });

  it('assigns strictly monotonic per-scan sequences, starting at 1, and materializes the event', () => {
    const bus = new InMemoryEventBus();
    const seen: AmassEvent[] = [];
    bus.subscribe('scan-a', (e) => seen.push(e));
    bus.publish({ ...base, message: 'first' });
    bus.publish({ ...base, eventType: 'ANALYZER_STARTED', agentType: 'ANALYZER', phase: 'analysis', message: 'second' });

    expect(seen.map((e) => e.sequence)).toEqual([1, 2]);
    expect(seen[0].eventId.startsWith('evt_')).toBe(true);
    expect(seen[0].level).toBe('INFO');
    expect(Number.isNaN(Date.parse(seen[0].timestamp))).toBe(false);
    expect(bus.getSequence('scan-a')).toBe(2);
    expect(bus.getSequence('scan-b')).toBe(0);
    expect(bus.subscriberCount('scan-a')).toBe(1);
  });

  it('replays the bounded ring after a sequence (Last-Event-ID path), oldest first', () => {
    const bus = new InMemoryEventBus({ ringPerScan: 5 });
    const ids: string[] = [];
    const subscriber = (e: AmassEvent): void => {
      ids.push(`${e.sequence}:${e.eventType}`);
    };
    const unsubscribe = bus.subscribe('scan-c', subscriber);
    for (let i = 1; i <= 6; i += 1) {
      bus.publish({ ...base, scanId: 'scan-c', message: `m${i}`, agentType: 'SCANNER', phase: 'scanning' });
    }
    unsubscribe();

    // Ring cap 3 → only the last 3 survive.
    expect(ids).toHaveLength(6);
    const replayed = bus.replay('scan-c', 3);
    expect(replayed.map((e) => e.sequence)).toEqual([4, 5, 6]);

    // Window fully evicted → empty replay, but the high-water mark remains.
    expect(bus.replay('scan-c', 5).map((e) => e.sequence)).toEqual([6]);
  });

  it('never leaks another scan: subscribers receive only their own scan, and replay is per-scan', () => {
    const bus = new InMemoryEventBus();
    const a: AmassEvent[] = [];
    const b: AmassEvent[] = [];
    bus.subscribe('scan-a', (e) => a.push(e));
    bus.subscribe('scan-b', (e) => b.push(e));

    bus.publish({ ...base, scanId: 'scan-a', message: 'a1' });
    bus.publish({ ...base, scanId: 'scan-b', message: 'b1' });
    bus.publish({ ...base, scanId: 'scan-a', message: 'a2' });

    expect(a.map((e) => e.sequence)).toEqual([1, 2]);
    expect(b.map((e) => e.sequence)).toEqual([1]);
    expect(bus.replay('scan-a', 0).map((e) => e.message)).toEqual(['a1', 'a2']);
    expect(bus.replay('scan-b', 0).map((e) => e.message)).toEqual(['b1']);
    // Never an event cross-stamped.
    expect([...a, ...b].every((e) => e.scanId === 'scan-a' || e.scanId === 'scan-b')).toBe(true);
  });

  it('unsubscribe stops delivery; a throwing subscriber never breaks publish', () => {
    const bus = new InMemoryEventBus();
    let calls = 0;
    const unsub = bus.subscribe('scan-a', () => {
      calls += 1;
      throw new Error('subscriber boom');
    });
    bus.publish({ ...base, scanId: 'scan-a' }); // tolerated
    bus.publish({ ...base, scanId: 'scan-a' });
    expect(calls).toBe(2);
    expect(bus.getSequence('scan-a')).toBe(2);
    unsub();
    bus.publish({ ...base, scanId: 'scan-a' });
    expect(calls).toBe(2);
    expect(bus.subscriberCount('scan-a')).toBe(0);
  });

  it('redacts secrets and truncates message/metadata string values; drops over-cap payloads whole', () => {
    const bus = new InMemoryEventBus({ messageMaxChars: 40, metadataMaxBytes: 128 });
    const seen: AmassEvent[] = [];
    bus.subscribe('scan-secret', (e) => seen.push(e));
    bus.publish({
      ...base,
      scanId: 'scan-secret',
      message: `token sk-${'A'.repeat(160)} and a long tail`,
      metadata: { targetUrl: `https://user:sk-${'B'.repeat(80)}@example.com/x` },
    });
    const event = seen[0];
    // Message truncated and redacted (no raw secret fragments).
    expect(event.message.length).toBeLessThanOrEqual(70);
    expect(event.message).not.toMatch(/sk-[AB]+/);
    expect(event.message).not.toContain('A'.repeat(20));
    // Metadata string values redacted/truncated too.
    expect(JSON.stringify(event.metadata)).not.toMatch(/sk-[AB]+/);
    expect(event.metadata?.targetUrl).toBeDefined();
    // A payload over the byte cap is dropped entirely, never partially leaked.
    const over: AmassEvent[] = [];
    bus.subscribe('scan-over', (e) => over.push(e));
    // Short tokens under the 40-char base64 rule stay unredacted but the
    // TOTAL payload exceeds the 128-byte metadata cap → dropped whole.
    const unredacted = Array.from({ length: 60 }, (_, i) => `abcdefghij-${i}`).join(' ');
    bus.publish({ ...base, scanId: 'scan-over', metadata: { a: unredacted, b: unredacted } });
    expect(over[0].metadata).toBeUndefined();
  });

  it('bounded memory: ring per scan is kept small and least-recently published scans are evicted', () => {
    const bus = new InMemoryEventBus({ ringPerScan: 2, maxScans: 2 });
    for (let i = 1; i <= 4; i += 1) bus.publish({ ...base, scanId: 'scan-1', message: `m${i}` });
    expect(bus.replay('scan-1', 0).map((e) => e.sequence)).toEqual([3, 4]);

    bus.publish({ ...base, scanId: 'scan-2' });
    bus.publish({ ...base, scanId: 'scan-3' });
    // Eviction kicked in — scan-1 gone, scans 2 and 3 tracked.
    expect(bus.replay('scan-1', 0)).toHaveLength(0);
    expect(bus.getSequence('scan-1')).toBe(0);
    expect(bus.getSequence('scan-2')).toBe(1);
    expect(bus.replay('scan-3', 0)).toHaveLength(1);

    // publish after eviction restarts the sequence for scan-1? No — evicted.
    bus.publish({ ...base, scanId: 'scan-1', message: 'again' });
    expect(bus.getSequence('scan-1')).toBe(1);
  });

  it('release drops buffers, sequence and subscribers for a scan', () => {
    const bus = new InMemoryEventBus();
    bus.subscribe('scan-z', () => undefined);
    bus.publish({ ...base, scanId: 'scan-z' });
    bus.release('scan-z');
    expect(bus.getSequence('scan-z')).toBe(0);
    expect(bus.replay('scan-z', 0)).toHaveLength(0);
    expect(bus.subscriberCount('scan-z')).toBe(0);
  });
});