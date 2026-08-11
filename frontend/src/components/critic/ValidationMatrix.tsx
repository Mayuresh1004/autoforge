import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { CriticStageState } from '../../hooks/useScanStore';
import type { FindingModel } from '../../types/api-types';

export interface ValidationMatrixProps {
  stages: CriticStageState[];
  activeFinding?: FindingModel | null;
  activeFindingId?: string | null;
}

export function ValidationMatrix({ stages, activeFinding }: ValidationMatrixProps) {
  const isApproved = stages.find((s) => s.key === 'approval')?.status === 'PASSED';
  const isRejected = stages.find((s) => s.key === 'approval')?.status === 'FAILED';

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Critic Quality Assurance & Validation</CardTitle>
          <p className="text-[11px] text-zinc-500 mt-0.5">6-Gate Sandbox Verification Pipeline</p>
        </div>
        <Badge variant={isApproved ? 'success' : isRejected ? 'danger' : 'outline'}>
          {isApproved ? '✓ APPROVED' : isRejected ? '✕ REJECTED' : 'VALIDATION IN PROGRESS'}
        </Badge>
      </CardHeader>

      {activeFinding && (
        <div className="mx-4 mb-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-300 font-mono">
          <span className="font-semibold block mb-0.5">Validating Patch For: {activeFinding.title} ({activeFinding.cwe || activeFinding.id})</span>
          <span className="text-[11px] opacity-80">{activeFinding.filePath}:{activeFinding.lineStart}</span>
        </div>
      )}

      <div className="space-y-2.5 px-4 pb-4">
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
