import { AgentCard } from './AgentCard';
import type { AgentState } from '../../hooks/useScanStore';
import type { AmassAgentType } from '../../types/amass-events';

export interface AgentPipelineProps {
  agents: Record<AmassAgentType, AgentState>;
}

const PIPELINE_STEPS: Array<{ type: AmassAgentType; label: string }> = [
  { type: 'ANALYZER', label: 'Analyzer' },
  { type: 'SCANNER', label: 'Scanner' },
  { type: 'SANDBOX', label: 'Sandbox' },
  { type: 'SCOUT', label: 'Scout' },
  { type: 'PLANNER', label: 'Planner' },
  { type: 'SNIPER', label: 'Sniper' },
  { type: 'ENGINEER', label: 'Engineer' },
  { type: 'CRITIC', label: 'Critic' },
];

export function AgentPipeline({ agents }: AgentPipelineProps) {
  return (
    <div className="border-b border-zinc-800 bg-zinc-950/60 px-6 py-2.5 overflow-x-auto">
      <div className="flex items-center gap-1 min-w-max">
        <span className="mr-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 font-mono">
          Pipeline Status:
        </span>
        {PIPELINE_STEPS.map((step, idx) => (
          <AgentCard
            key={step.type}
            agentType={step.type}
            label={step.label}
            state={agents[step.type] ?? { type: step.type, status: 'IDLE' }}
            isLast={idx === PIPELINE_STEPS.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
