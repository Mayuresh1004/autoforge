import { cn } from '../../utils/cn';
import type { AgentState } from '../../hooks/useScanStore';
import type { AmassAgentType } from '../../types/amass-events';

export interface AgentCardProps {
  agentType: AmassAgentType;
  label: string;
  state: AgentState;
  isLast?: boolean;
}

export function AgentCard({ label, state, isLast = false }: AgentCardProps) {
  const isRunning = state.status === 'RUNNING';
  const isCompleted = state.status === 'COMPLETED';
  const isFailed = state.status === 'FAILED';

  return (
    <div className="flex items-center">
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-all',
          isRunning && 'border-sky-500/50 bg-sky-500/10 text-sky-300 shadow-sm shadow-sky-500/20 ring-1 ring-sky-500/30',
          isCompleted && 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400',
          isFailed && 'border-rose-500/30 bg-rose-500/10 text-rose-400',
          state.status === 'IDLE' && 'border-zinc-800 bg-zinc-950/40 text-zinc-500'
        )}
      >
        {/* Status Indicator Icon */}
        <span className="flex h-2 w-2 items-center justify-center">
          {isRunning ? (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
            </span>
          ) : isCompleted ? (
            <span className="text-emerald-400 font-bold text-[10px]">✓</span>
          ) : isFailed ? (
            <span className="text-rose-400 font-bold text-[10px]">✕</span>
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
          )}
        </span>

        <div className="flex flex-col">
          <span className="font-medium tracking-tight flex items-center gap-1">
            {label}
            {state.prNumber ? <span className="font-mono text-emerald-300 font-bold">#{state.prNumber}</span> : null}
          </span>
          {state.prUrl ? (
            <a
              href={state.prUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-[9px] text-sky-400 hover:text-sky-300 underline font-semibold flex items-center gap-0.5"
            >
              View PR ↗
            </a>
          ) : (
            <span className="font-mono text-[9px] uppercase tracking-wider opacity-75">
              {state.status}
            </span>
          )}
        </div>
      </div>

      {!isLast && (
        <div className="mx-1.5 h-0.5 w-3 rounded-full bg-zinc-800" />
      )}
    </div>
  );
}
