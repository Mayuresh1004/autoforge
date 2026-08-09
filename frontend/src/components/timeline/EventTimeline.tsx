import { useState, useRef, useEffect, useMemo } from 'react';
import { EventItem } from './EventItem';
import { Dialog } from '../ui/Dialog';
import { CodeBlock } from '../ui/CodeBlock';
import { Button } from '../ui/Button';
import type { AmassEvent, AmassAgentType } from '../../types/amass-events';
import { AMASS_AGENT_TYPES } from '../../types/amass-events';

export interface EventTimelineProps {
  events: AmassEvent[];
  lastSequence: number;
  connectionStatus: string;
}

export function EventTimeline({ events, lastSequence }: EventTimelineProps) {
  const [selectedAgent, setSelectedAgent] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [inspectedEvent, setInspectedEvent] = useState<AmassEvent | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Auto scroll handling
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  // Filter events
  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      if (selectedAgent !== 'ALL' && evt.agentType !== selectedAgent) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const msg = evt.message.toLowerCase();
        const type = evt.eventType.toLowerCase();
        return msg.includes(q) || type.includes(q);
      }
      return true;
    });
  }, [events, selectedAgent, searchQuery]);

  return (
    <div className="flex h-full flex-col border border-zinc-800 bg-zinc-950/80 rounded-xl overflow-hidden shadow-sm">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/70 px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold uppercase tracking-wider text-zinc-200">
            Live Event Stream
          </span>
          <span className="rounded bg-sky-500/10 px-2 py-0.5 font-mono text-[10px] text-sky-400 border border-sky-500/30">
            Seq #{lastSequence}
          </span>
        </div>

        {/* Filters & Controls */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search logs..."
            className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200 placeholder-zinc-600 focus:border-sky-500 focus:outline-none"
          />

          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 focus:border-sky-500 focus:outline-none"
          >
            <option value="ALL">All Agents</option>
            {AMASS_AGENT_TYPES.map((agent: AmassAgentType) => (
              <option key={agent} value={agent}>
                {agent}
              </option>
            ))}
          </select>

          <Button
            variant={autoScroll ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setAutoScroll((prev) => !prev)}
            className="text-[11px] py-1 px-2"
          >
            {autoScroll ? '● Auto-Scroll ON' : 'Pause Scroll'}
          </Button>
        </div>
      </div>

      {/* Stream Terminal Window */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto divide-y divide-zinc-900 bg-zinc-950 p-1 min-h-[300px] max-h-[600px]"
      >
        {filteredEvents.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center text-xs text-zinc-500 italic">
            {events.length === 0
              ? 'Waiting for real-time SSE events from AMASS backend...'
              : 'No events match the current filter.'}
          </div>
        ) : (
          filteredEvents.map((evt) => (
            <EventItem key={evt.eventId || `${evt.sequence}-${evt.eventType}`} event={evt} onInspect={setInspectedEvent} />
          ))
        )}
      </div>

      {/* Footer Info Bar */}
      <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/40 px-3 py-1 text-[10px] text-zinc-500 font-mono">
        <span>Showing {filteredEvents.length} of {events.length} events</span>
        <span>Click any event to inspect raw payload</span>
      </div>

      {/* Raw Payload Inspector Modal */}
      <Dialog
        isOpen={Boolean(inspectedEvent)}
        onClose={() => setInspectedEvent(null)}
        title={`Inspect Event Frame #${inspectedEvent?.sequence} [${inspectedEvent?.eventType}]`}
      >
        {inspectedEvent && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs font-mono text-zinc-400 bg-zinc-900/50 p-2.5 rounded-lg border border-zinc-800">
              <div><span className="text-zinc-500">Event ID:</span> {inspectedEvent.eventId}</div>
              <div><span className="text-zinc-500">Sequence:</span> #{inspectedEvent.sequence}</div>
              <div><span className="text-zinc-500">Agent:</span> {inspectedEvent.agentType ?? 'N/A'}</div>
              <div><span className="text-zinc-500">Phase:</span> {inspectedEvent.phase}</div>
              <div><span className="text-zinc-500">Level:</span> {inspectedEvent.level}</div>
              <div><span className="text-zinc-500">Status:</span> {inspectedEvent.status}</div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-zinc-300 mb-1">Sanitized Message</h4>
              <p className="font-mono text-xs text-zinc-200 bg-zinc-900 p-2.5 rounded-lg border border-zinc-800">
                {inspectedEvent.message}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-zinc-300 mb-1">Raw JSON Payload</h4>
              <CodeBlock code={JSON.stringify(inspectedEvent, null, 2)} language="json" />
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
