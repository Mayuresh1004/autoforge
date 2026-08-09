import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { CriticStageState } from '../../hooks/useScanStore';

export interface ValidationMatrixProps {
  stages: CriticStageState[];
}

export function ValidationMatrix({ stages }: ValidationMatrixProps) {
  const isApproved = stages.find((s) => s.key === 'approval')?.status === 'PASSED';
  const isRejected = stages.find((s) => s.key === 'approval')?.status === 'FAILED';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Critic Quality Assurance & Validation</CardTitle>
        <Badge variant={isApproved ? 'success' : isRejected ? 'danger' : 'outline'}>
          {isApproved ? '✓ APPROVED' : isRejected ? '✕ REJECTED' : 'VALUATION IN PROGRESS'}
        </Badge>
      </CardHeader>

      <div className="space-y-2.5">
        {stages.map((stage) => {
          const isPassed = stage.status === 'PASSED';
          const isRunning = stage.status === 'RUNNING';
          const isFailed = stage.status === 'FAILED';

          return (
            <div
              key={stage.key}
              className={`flex items-center justify-between rounded-lg border p-3 text-xs transition-colors ${
                isPassed
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
                  : isRunning
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                    : isFailed
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                      : 'border-zinc-800 bg-zinc-900/40 text-zinc-500'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold">
                  {isPassed ? (
                    <span className="text-emerald-400">✓</span>
                  ) : isRunning ? (
                    <span className="text-sky-400 animate-spin">◌</span>
                  ) : isFailed ? (
                    <span className="text-rose-400">✕</span>
                  ) : (
                    <span className="text-zinc-600">•</span>
                  )}
                </span>
                <div>
                  <span className="font-medium text-zinc-200 block">{stage.name}</span>
                  {stage.message && <span className="text-[11px] text-zinc-400 font-mono block">{stage.message}</span>}
                </div>
              </div>

              <span className="font-mono text-[10px] uppercase font-semibold">
                {stage.status}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
