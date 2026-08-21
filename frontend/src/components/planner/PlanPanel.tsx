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
        <div>
          <CardTitle>Attack Plan & Targets</CardTitle>
          <p className="text-[11px] text-zinc-500 mt-0.5">Finding-Aware Target Prioritization & Strategy</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="purple">{targets.length} {targets.length === 1 ? 'Plan' : 'Plans'}</Badge>
          {sandboxStatus && <Badge variant={sandboxStatus === 'READY' ? 'success' : 'info'}>{sandboxStatus}</Badge>}
        </div>
      </CardHeader>

      {targets.length === 0 ? (
        <div className="p-8 text-center text-xs text-zinc-500 italic">
          No attack plans generated yet. Planner agent generates prioritized attack targets after Scout reconnaissance completes.
        </div>
      ) : (
        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
          {targets.map((target, idx) => {
            const planNum = String(idx + 1).padStart(2, '0');
            return (
              <div
                key={target.targetId || target.findingId || `plan-${idx}`}
                className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-2 text-xs transition-all hover:border-zinc-700"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-mono">
                    <span className="rounded bg-sky-500/20 text-sky-300 px-2 py-0.5 text-[10px] font-bold border border-sky-500/30">
                      Plan {planNum}
                    </span>
                    <span className="font-semibold text-zinc-100">{target.vulnerabilityType}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={RISK_VARIANT[target.estimatedRisk ?? ''] ?? 'outline'} size="sm">
                      {target.estimatedRisk ?? 'HIGH'}
                    </Badge>
                    <Badge variant="info" size="sm" className="font-mono text-[9px]">
                      {target.status ?? 'PLANNED'}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-2 font-mono text-[11px] bg-zinc-950/80 p-2 rounded border border-zinc-800/80">
                  <span className="font-bold text-sky-400">{target.method ?? 'GET'}</span>
                  <span className="text-zinc-200 break-all">{target.endpoint}</span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono pt-1">
                  <span>Priority Score: <strong className="text-amber-400">{target.priorityScore ?? target.priority}</strong></span>
                  <div className="flex items-center gap-2 text-zinc-500">
                    {target.findingId && <span className="text-sky-400 font-semibold">Finding: {target.findingId}</span>}
                    <span>Target ID: {target.targetId}</span>
                  </div>
                </div>

                {(target.reason || target.rationale) && (
                  <p className="text-[11px] text-zinc-300 leading-relaxed font-sans pt-1">
                    <strong className="text-zinc-400 font-mono text-[10px]">Reason: </strong>
                    {target.reason || target.rationale}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
