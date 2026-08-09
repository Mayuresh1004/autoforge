import type { VulnerabilitySeverity } from '../types/api-types';
import type { AmassEventLevel } from '../types/amass-events';
import type { AgentStatus } from '../hooks/useScanStore';

export const SEVERITY_COLORS: Record<VulnerabilitySeverity, { bg: string; text: string; border: string }> = {
  CRITICAL: {
    bg: 'bg-rose-500/10',
    text: 'text-rose-400',
    border: 'border-rose-500/30',
  },
  HIGH: {
    bg: 'bg-orange-500/10',
    text: 'text-orange-400',
    border: 'border-orange-500/30',
  },
  MEDIUM: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
  },
  LOW: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/30',
  },
  INFO: {
    bg: 'bg-zinc-500/10',
    text: 'text-zinc-400',
    border: 'border-zinc-500/30',
  },
};

export const LEVEL_COLORS: Record<AmassEventLevel, { text: string; bg: string }> = {
  DEBUG: { text: 'text-zinc-400', bg: 'bg-zinc-800/50' },
  INFO: { text: 'text-sky-400', bg: 'bg-sky-950/30' },
  WARN: { text: 'text-amber-400', bg: 'bg-amber-950/30' },
  ERROR: { text: 'text-rose-400', bg: 'bg-rose-950/30' },
};

export const AGENT_STATUS_COLORS: Record<AgentStatus, { badgeBg: string; text: string; ring: string }> = {
  IDLE: {
    badgeBg: 'bg-zinc-900 border-zinc-800',
    text: 'text-zinc-500',
    ring: 'ring-zinc-800',
  },
  RUNNING: {
    badgeBg: 'bg-sky-500/10 border-sky-500/30',
    text: 'text-sky-400',
    ring: 'ring-sky-500/50 animate-pulse',
  },
  COMPLETED: {
    badgeBg: 'bg-emerald-500/10 border-emerald-500/30',
    text: 'text-emerald-400',
    ring: 'ring-emerald-500/30',
  },
  FAILED: {
    badgeBg: 'bg-rose-500/10 border-rose-500/30',
    text: 'text-rose-400',
    ring: 'ring-rose-500/30',
  },
};
