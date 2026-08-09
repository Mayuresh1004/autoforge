import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { PlanModel } from '../../types/api-types';

export interface PlanPanelProps {
  plan: PlanModel | null | undefined;
  sandboxStatus?: string | null;
}

const RISK_VARIANT: Record<string, 'danger' | 'warning' | 'info' | 'outline'> = {
  CRITICAL: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'info',
};

export function PlanPanel({ plan, sandboxStatus }: PlanPanelProps) {
  const targets = plan?.targets ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attack Plan & Targets</CardTitle>
        <div className="flex items-center gap-2">
          {plan && <Badge variant="purple">{targets.length} Targets</Badge>}
          {sandboxStatus && <Badge variant={sandboxStatus === 'READY' ? 'success' : 'info'}>{sandboxStatus}</Badge>}
        </div>
      </CardHeader>

      {!plan || targets.length === 0 ? (
        <div className="p-6 text-center text-xs text-zinc-500 italic">
          No attack plan available yet. Planner will populate prioritized targets after Scout recon completes.
        </div>
      ) : (
        <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
          {targets.map((target) => (
            <div
              key={target.targetId}
              className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sky-400 font-semibold">{target.method ?? 'GET'}</span>
                  <span className="font-mono text-zinc-200 break-all">{target.endpoint}</span>
                </div>
                <Badge variant={RISK_VARIANT[target.estimatedRisk ?? ''] ?? 'outline'}>{target.estimatedRisk}</Badge>
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                <span>Priority: {target.priorityScore}</span>
                <span>Target #{target.targetId}</span>
              </div>

              <div className="text-[11px] text-zinc-300">{target.rationale ?? target.reason}</div>

              <div className="flex flex-wrap gap-1.5">
                {(target.candidateVulnerabilities ?? []).map((candidate) => (
                  <span key={candidate} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 border border-zinc-700">
                    {candidate}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
