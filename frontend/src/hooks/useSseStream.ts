/**
 * Custom hook for consuming the real AMASS Phase 9 SSE Stream (`GET /api/scans/:scanId/events`).
 *
 * Handles:
 *  - EventSource initialization & proper event listeners for named events (AMASS_EVENT_TYPES)
 *  - Monotonic `sequence` ordering & duplicate filtering
 *  - Connection state tracking ('CONNECTED' | 'RECONNECTING' | 'DISCONNECTED')
 *  - Clean error handling & unmount cleanup
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { AmassEvent, SseConnectionStatus } from '../types/amass-events';
import { AMASS_EVENT_TYPES } from '../types/amass-events';

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:3001';

export interface UseSseStreamOptions {
  scanId: string | null;
  onEvent?: (event: AmassEvent) => void;
  enabled?: boolean;
}

export interface UseSseStreamResult {
  status: SseConnectionStatus;
  events: AmassEvent[];
  lastSequence: number;
  error: string | null;
  reconnect: () => void;
  clearEvents: () => void;
}

export function useSseStream({ scanId, onEvent, enabled = true }: UseSseStreamOptions): UseSseStreamResult {
  const [status, setStatus] = useState<SseConnectionStatus>('DISCONNECTED');
  const [events, setEvents] = useState<AmassEvent[]>([]);
  const [lastSequence, setLastSequence] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const highestSequenceRef = useRef<number>(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const clearEvents = useCallback(() => {
    setEvents([]);
    setLastSequence(0);
    highestSequenceRef.current = 0;
  }, []);

  const handleIncomingEvent = useCallback((rawEventData: string) => {
    try {
      const parsed: AmassEvent = JSON.parse(rawEventData);
      if (!parsed || typeof parsed.sequence !== 'number') return;

      // Monotonic sequence deduplication & ordering guard
      if (parsed.sequence <= highestSequenceRef.current) {
        return; // ignore duplicate or stale replayed event
      }

      highestSequenceRef.current = parsed.sequence;
      setLastSequence(parsed.sequence);

      setEvents((prev) => {
        const next = [...prev, parsed];
        // Keep up to 500 events in client ring
        if (next.length > 500) {
          return next.slice(next.length - 500);
        }
        return next;
      });

      if (onEventRef.current) {
        onEventRef.current(parsed);
      }
    } catch {
      /* ignore invalid json frames */
    }
  }, []);

  const connect = useCallback(() => {
    if (!scanId || !enabled) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setStatus('DISCONNECTED');
      return;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setStatus('RECONNECTING');
    setError(null);

    const streamUrl = `${API_BASE_URL}/api/scans/${encodeURIComponent(scanId)}/events`;
    const es = new EventSource(streamUrl, { withCredentials: true });
    eventSourceRef.current = es;

    es.onopen = () => {
      setStatus('CONNECTED');
      setError(null);
    };

    es.onerror = () => {
      // EventSource handles reconnection natively under the hood
      if (es.readyState === EventSource.CONNECTING) {
        setStatus('RECONNECTING');
      } else if (es.readyState === EventSource.CLOSED) {
        setStatus('DISCONNECTED');
      }
    };

    // Named event listeners — browser EventSource only triggers named events via addEventListener!
    for (const eventType of AMASS_EVENT_TYPES) {
      es.addEventListener(eventType, (evt: MessageEvent) => {
        handleIncomingEvent(evt.data);
      });
    }

    // Generic fallback for unnamed messages (if any)
    es.onmessage = (evt: MessageEvent) => {
      handleIncomingEvent(evt.data);
    };
  }, [scanId, enabled, handleIncomingEvent]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setStatus('DISCONNECTED');
    };
  }, [connect]);

  return {
    status,
    events,
    lastSequence,
    error,
    reconnect: connect,
    clearEvents,
  };
}
