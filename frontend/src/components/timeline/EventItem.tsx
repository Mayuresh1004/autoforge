import { cn } from '../../utils/cn';
import { formatSequence, formatTimestamp } from '../../utils/formatters';
import { LEVEL_COLORS } from '../../utils/theme';
import type { AmassEvent } from '../../types/amass-events';

export interface EventItemProps {
  event: AmassEvent;
  onInspect: (event: AmassEvent) => void;
}

export function EventItem({ event, onInspect }: EventItemProps) {
  const levelStyle = LEVEL_COLORS[event.level] ?? LEVEL_COLORS.INFO;

  return (
    <div
      onClick={() => onInspect(event)}
      className="group flex flex-wrap items-start gap-2 border-b border-zinc-900 px-3 py-1.5 font-mono text-xs hover:bg-zinc-900/60 cursor-pointer transition-colors"
    >
      {/* Monotonic Sequence Number */}
      <span className="text-sky-400 font-bold text-[11px] min-w-[50px]">
        {formatSequence(event.sequence)}
      </span>

      {/* Timestamp */}
      <span className="text-zinc-500 text-[11px] min-w-[65px]">
        {formatTimestamp(event.timestamp)}
      </span>

      {/* Agent Tag */}
      {event.agentType && (
        <span className="rounded bg-zinc-900 px-1.5 py-0.2 text-[10px] font-semibold text-zinc-300 border border-zinc-800">
          {event.agentType}
        </span>
      )}

      {/* Event Type & Level */}
      <span className={cn('rounded px-1.5 py-0.2 text-[10px] font-medium uppercase', levelStyle.bg, levelStyle.text)}>
        {event.eventType}
      </span>

      {/* Phase Tag */}
      <span className="text-[10px] text-zinc-500 italic">[{event.phase}]</span>

      {/* Message Content */}
      <span className="flex-1 text-zinc-300 text-[11px] break-words">
        {event.message}
      </span>

      {/* Inspect Raw Metadata Indicator */}
      <span className="opacity-0 group-hover:opacity-100 text-[10px] text-sky-400 transition-opacity">
        Inspect →
      </span>
    </div>
  );
}
