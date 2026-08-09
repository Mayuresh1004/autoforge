import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSseStream } from './useSseStream';
import type { AmassEvent } from '../types/amass-events';

// Mock EventSource API
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, ((event: { data: string }) => void)[]> = {};
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readyState = 0;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (event: { data: string }) => void) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
    }
  }

  close() {
    this.readyState = 2; // CLOSED
  }

  emit(eventType: string, eventData: AmassEvent) {
    const rawData = JSON.stringify(eventData);
    if (this.listeners[eventType]) {
      for (const cb of this.listeners[eventType]) {
        cb({ data: rawData });
      }
    }
    if (this.onmessage) {
      this.onmessage({ data: rawData });
    }
  }

  triggerOpen() {
    this.readyState = 1;
    if (this.onopen) this.onopen();
  }
}

describe('useSseStream hook', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in DISCONNECTED status when scanId is null', () => {
    const { result } = renderHook(() => useSseStream({ scanId: null }));
    expect(result.current.status).toBe('DISCONNECTED');
    expect(result.current.events).toEqual([]);
  });

  it('connects to SSE endpoint and receives named events with sequence ordering', () => {
    const onEventMock = vi.fn();
    const { result } = renderHook(() =>
      useSseStream({ scanId: 'scan_123', onEvent: onEventMock })
    );

    expect(MockEventSource.instances.length).toBe(1);
    const es = MockEventSource.instances[0];

    act(() => {
      es.triggerOpen();
    });

    expect(result.current.status).toBe('CONNECTED');

    const event1: AmassEvent = {
      eventId: 'evt_1',
      scanId: 'scan_123',
      sequence: 1,
      timestamp: '2026-08-09T12:00:00Z',
      eventType: 'SCAN_STARTED',
      agentType: 'SYSTEM',
      phase: 'scan',
      level: 'INFO',
      status: 'STARTED',
      message: 'Scan scan_123 started',
    };

    act(() => {
      es.emit('SCAN_STARTED', event1);
    });

    expect(result.current.events.length).toBe(1);
    expect(result.current.lastSequence).toBe(1);
    expect(onEventMock).toHaveBeenCalledWith(event1);
  });

  it('ignores duplicate or out-of-order sequence events', () => {
    const { result } = renderHook(() => useSseStream({ scanId: 'scan_123' }));
    const es = MockEventSource.instances[0];

    act(() => {
      es.triggerOpen();
    });

    const event1: AmassEvent = {
      eventId: 'evt_1',
      scanId: 'scan_123',
      sequence: 10,
      timestamp: '2026-08-09T12:00:00Z',
      eventType: 'SCOUT_STARTED',
      agentType: 'SCOUT',
      phase: 'recon',
      level: 'INFO',
      status: 'STARTED',
      message: 'Scout started',
    };

    const duplicateEvent: AmassEvent = {
      ...event1,
      sequence: 10,
    };

    const staleEvent: AmassEvent = {
      ...event1,
      sequence: 5,
    };

    act(() => {
      es.emit('SCOUT_STARTED', event1);
    });
    expect(result.current.events.length).toBe(1);

    // Emit duplicate
    act(() => {
      es.emit('SCOUT_STARTED', duplicateEvent);
    });
    expect(result.current.events.length).toBe(1); // sequence 10 ignored

    // Emit stale
    act(() => {
      es.emit('SCOUT_STARTED', staleEvent);
    });
    expect(result.current.events.length).toBe(1); // sequence 5 ignored
  });
});
