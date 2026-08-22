import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { CriticStageState } from '../../hooks/useScanStore';
import type { FindingModel, PatchModel } from '../../types/api-types';

export interface ValidationMatrixProps {
  stages?: CriticStageState[];
  criticMatrix?: Record<string, CriticStageState[]>;
  findings?: FindingModel[];
  patches?: PatchModel[];
  activeFinding?: FindingModel | null;
  activeFindingId?: string | null;
  onSelectFindingId?: (findingId: string) => void;
}

export function ValidationMatrix({
  stages = [],
  criticMatrix = {},
  findings = [],
  patches = [],
  activeFinding,
  onSelectFindingId,
}: ValidationMatrixProps) {
  const activeFindingId = activeFinding?.id || activeFinding?.findingId;

  // Determine list of findings to display rows for
  const displayFindings = findings.length > 0
    ? findings
    : activeFinding
      ? [activeFinding]
      : [];

  const verifiedCount = displayFindings.filter((f) => {
    const fId = f.id || f.findingId || '';
    const fStages = criticMatrix[fId];
    return f.status === 'CRITIC_VERIFIED' || fStages?.find((s) => s.key === 'approval')?.status === 'PASSED';
  }).length;

  const rejectedCount = displayFindings.filter((f) => {
    const fId = f.id || f.findingId || '';
    const fStages = criticMatrix[fId];
    return f.status === 'EXPLOIT_REJECTED' || fStages?.find((s) => s.key === 'approval')?.status === 'FAILED';
  }).length;

  const renderStatusPill = (status?: CriticStageState['status']) => {
    if (status === 'PASSED') {
      return <span className="font-bold text-emerald-400">PASS</span>;
    }
    if (status === 'FAILED') {
      return <span className="font-bold text-rose-400">FAIL</span>;
    }
    if (status === 'RUNNING') {
      return <span className="font-bold text-sky-400 animate-pulse">RUNNING</span>;
    }
    return <span className="text-zinc-600">PENDING</span>;
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Critic QA Matrix</CardTitle>
          <p className="text-[11px] text-zinc-500 mt-0.5">Per-Vulnerability 6-Gate Sandbox Verification Pipeline</p>
        </div>
        <div className="flex items-center gap-2">
          {rejectedCount > 0 ? (
            <Badge variant="danger">{rejectedCount} Rejected</Badge>
          ) : verifiedCount > 0 ? (
            <Badge variant="success">{verifiedCount} / {displayFindings.length} Approved</Badge>
          ) : (
            <Badge variant="outline" className="font-mono text-[10px]">VALIDATION PENDING</Badge>
          )}
        </div>
      </CardHeader>

      {displayFindings.length === 0 ? (
        <div className="p-8 text-center text-xs text-zinc-500 italic">
          No Critic validation records yet. Critic agent will validate each generated patch across all 6 quality gates independently.
        </div>
      ) : (
        <div className="space-y-4 px-4 pb-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] text-zinc-400 uppercase tracking-wider bg-zinc-900/80">
                  <th className="p-2.5 rounded-l">Finding</th>
                  <th className="p-2.5 text-center">Baseline</th>
                  <th className="p-2.5 text-center">Patch</th>
                  <th className="p-2.5 text-center">Build</th>
                  <th className="p-2.5 text-center">Tests</th>
                  <th className="p-2.5 text-center">Retest</th>
                  <th className="p-2.5 text-center">Verdict</th>
                  <th className="p-2.5 text-center rounded-r">Pull Request</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {displayFindings.map((f) => {
                  const fId = f.id || f.findingId || '';
                  const fStages = criticMatrix[fId] ?? stages;
                  const isSelected = activeFindingId === fId;

                  const baselineStatus = fStages.find((s) => s.key === 'baseline')?.status;
                  const patchStatus = fStages.find((s) => s.key === 'patch_apply')?.status;
                  const buildStatus = fStages.find((s) => s.key === 'build')?.status;
                  const testStatus = fStages.find((s) => s.key === 'tests')?.status;
                  const retestStatus = fStages.find((s) => s.key === 'retest')?.status;
                  const verdictStatus = fStages.find((s) => s.key === 'approval')?.status;

                  const patch = f.patch || patches.find((p) => p.findingId === fId || p.patchId?.includes(fId));

                  const shortId = (f.cwe || f.ruleId || fId).replace('OWASP-', '');

                  return (
                    <tr
                      key={fId}
                      onClick={() => onSelectFindingId?.(fId)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-sky-500/10 border-l-2 border-sky-500'
                          : 'hover:bg-zinc-900/60'
                      }`}
                    >
                      <td className="p-2.5">
                        <div className="font-semibold text-zinc-200 truncate max-w-[200px]">
                          {f.title || f.id}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {shortId} · {f.filePath}
                        </div>
                      </td>

                      <td className="p-2.5 text-center font-mono text-[11px]">
                        {renderStatusPill(baselineStatus)}
                      </td>

                      <td className="p-2.5 text-center font-mono text-[11px]">
                        {renderStatusPill(patchStatus)}
                      </td>

                      <td className="p-2.5 text-center font-mono text-[11px]">
                        {renderStatusPill(buildStatus)}
                      </td>

                      <td className="p-2.5 text-center font-mono text-[11px]">
                        {renderStatusPill(testStatus)}
                      </td>

                      <td className="p-2.5 text-center font-mono text-[11px]">
                        {renderStatusPill(retestStatus)}
                      </td>

                      <td className="p-2.5 text-center font-mono text-[11px]">
                        {verdictStatus === 'PASSED' || f.status === 'CRITIC_VERIFIED' ? (
                          <Badge variant="success" size="sm">APPROVED</Badge>
                        ) : verdictStatus === 'FAILED' || f.status === 'EXPLOIT_REJECTED' ? (
                          <Badge variant="danger" size="sm">REJECTED</Badge>
                        ) : (
                          <span className="text-zinc-500 text-[10px]">PENDING</span>
                        )}
                      </td>

                      <td className="p-2.5 text-center font-mono text-[11px]">
                        {patch?.prNumber || patch?.prUrl ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <Badge variant="success" size="sm" className="text-[9px]">
                              ✓ PR #{patch.prNumber}
                            </Badge>
                            {patch.prUrl && (
                              <a
                                href={patch.prUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-[10px] text-sky-400 hover:text-sky-300 underline font-bold flex items-center gap-0.5"
                              >
                                View Pull Request ↗
                              </a>
                            )}
                            {patch.prBranch && (
                              <span className="text-[9px] text-zinc-400 truncate max-w-[120px]" title={patch.prBranch}>
                                {patch.prBranch}
                              </span>
                            )}
                          </div>
                        ) : patch?.prError ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <Badge variant="danger" size="sm" className="text-[9px]">
                              ✕ PR FAILED
                            </Badge>
                            <span className="text-[9px] text-rose-400 truncate max-w-[120px]" title={patch.prError}>
                              {patch.prError}
                            </span>
                          </div>
                        ) : (
                          <span className="text-zinc-600 text-[10px]">PENDING</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
