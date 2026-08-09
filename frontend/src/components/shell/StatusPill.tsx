import { cn } from '../../utils/cn';
import type { SseConnectionStatus } from '../../types/amass-events';

export interface StatusPillProps {
  status: SseConnectionStatus;
  className?: string;
}

export function StatusPill({ status, className }: StatusPillProps) {
  const statusConfig: Record<SseConnectionStatus, { text: string; bg: string; dot: string }> = {
    CONNECTED: {
      text: 'LIVE SSE',
      bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
      dot: 'bg-emerald-400 animate-pulse',
    },
    RECONNECTING: {
      text: 'RECONNECTING',
      bg: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
      dot: 'bg-amber-400 animate-ping',
    },
    DISCONNECTED: {
      text: 'OFFLINE',
      bg: 'bg-zinc-800 text-zinc-400 border-zinc-700',
      dot: 'bg-zinc-500',
    },
  };

  const config = statusConfig[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium tracking-tight',
        config.bg,
        className
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />
      {config.text}
    </span>
  );
}
