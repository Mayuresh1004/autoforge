import { useState } from 'react';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { CodeBlock } from '../ui/CodeBlock';
import type { PatchModel, FindingModel } from '../../types/api-types';

export interface PullRequestPanelProps {
  patches: PatchModel[];
  activeFinding?: FindingModel | null;
  activeFindingId?: string | null;
  onSelectFindingId?: (findingId: string) => void;
}

export function PullRequestPanel({
  patches,
  activeFinding,
  onSelectFindingId,
}: PullRequestPanelProps) {
  const [selectedPatchId, setSelectedPatchId] = useState<string | null>(null);

  const targetFindingId = activeFinding?.findingId || activeFinding?.id;

  const deliveredPatches = patches.filter((p) => Boolean(p.prUrl || p.prNumber));
  const failedPatches = patches.filter((p) => Boolean(p.prError && !p.prUrl));

  const activePatch = patches.find(
    (p) =>
      (selectedPatchId && p.patchId === selectedPatchId) ||
      (targetFindingId && (p.findingId === targetFindingId || p.patchId.includes(targetFindingId)))
  ) ?? patches[0] ?? null;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Pull Request Remediation Delivery</CardTitle>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Automated Pull Requests Submitted to Remote GitHub Repository for Human Review
          </p>
        </div>
        <div className="flex items-center gap-2">
          {failedPatches.length > 0 ? (
            <Badge variant="danger">{failedPatches.length} Delivery Failed</Badge>
          ) : deliveredPatches.length > 0 ? (
            <Badge variant="success">{deliveredPatches.length} PR Created</Badge>
          ) : (
            <Badge variant="outline" className="font-mono text-[10px]">
              DELIVERY PENDING
            </Badge>
          )}
        </div>
      </CardHeader>

      {patches.length === 0 ? (
        <div className="p-8 text-center text-xs text-zinc-500 italic">
          No Pull Request records yet. Upon Critic QA approval, AMASS automatically clones the target repository, applies the verified patch, creates a git commit, pushes a remediation branch, and opens a GitHub Pull Request for human review.
        </div>
      ) : (
        <div className="space-y-4 px-4 pb-4">
          {/* PR Records Bar */}
          <div className="space-y-1.5 border-b border-zinc-800/80 pb-3">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1 font-mono">
              Pull Request Delivery Records ({patches.length})
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {patches.map((p) => {
                const isSelected = activePatch?.patchId === p.patchId;
                const shortId = (p.findingId || p.patchId)
                  .replace('fnd-', '')
                  .replace('patch-', '')
                  .toUpperCase();
                const isDelivered = Boolean(p.prUrl || p.prNumber);
                const isFailed = Boolean(p.prError && !p.prUrl);

                return (
                  <div
                    key={p.patchId}
                    onClick={() => {
                      setSelectedPatchId(p.patchId);
                      if (p.findingId && onSelectFindingId) {
                        onSelectFindingId(p.findingId);
                      }
                    }}
                    className={`cursor-pointer rounded-lg border p-2.5 transition-all text-xs ${
                      isSelected
                        ? 'border-sky-500 bg-sky-500/10 shadow-sm'
                        : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono text-[11px] mb-1">
                      <span className="font-bold text-sky-400">[ {shortId} ]</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded border font-bold ${
                          isDelivered
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                            : isFailed
                              ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                              : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                        }`}
                      >
                        {isDelivered
                          ? `PR #${p.prNumber ?? ''}`
                          : isFailed
                            ? 'FAILED'
                            : 'PENDING'}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-zinc-300 truncate">
                      {p.filePath}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active PR Details Inspector */}
          {activePatch && (
            <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
                <div>
                  <span className="text-zinc-500 block text-[10px] uppercase font-semibold">
                    Remediation Target File
                  </span>
                  <span className="text-emerald-400 font-semibold text-sm font-mono">
                    {activePatch.filePath || 'File Path Unavailable'}
                  </span>
                </div>

                {activePatch.prUrl || activePatch.prNumber ? (
                  <Badge variant="success" size="md">
                    ✓ PR CREATED #{activePatch.prNumber}
                  </Badge>
                ) : activePatch.prError ? (
                  <Badge variant="danger" size="md">
                    ✕ PR DELIVERY FAILED
                  </Badge>
                ) : (
                  <Badge variant="outline" size="md" className="text-zinc-400">
                    PENDING CRITIC APPROVAL & DELIVERY
                  </Badge>
                )}
              </div>

              {/* Delivery Details Card */}
              {activePatch.prUrl || activePatch.prNumber ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 font-mono text-xs space-y-3">
                  <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
                    <span className="font-bold text-emerald-300 text-sm flex items-center gap-2">
                      <span>✓</span> GitHub Pull Request Delivered
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold uppercase">
                      {activePatch.prStatus || 'OPEN'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                    <div>
                      <span className="text-zinc-400 text-[10px] block uppercase">PR Number:</span>
                      <span className="text-zinc-100 font-bold">#{activePatch.prNumber}</span>
                    </div>

                    {activePatch.prBranch && (
                      <div>
                        <span className="text-zinc-400 text-[10px] block uppercase">Remediation Branch:</span>
                        <span className="text-sky-300 font-bold truncate block">{activePatch.prBranch}</span>
                      </div>
                    )}

                    {activePatch.prCommitSha && (
                      <div>
                        <span className="text-zinc-400 text-[10px] block uppercase">Git Commit SHA:</span>
                        <span className="text-zinc-300 font-mono text-[10px]">{activePatch.prCommitSha}</span>
                      </div>
                    )}

                    {activePatch.prDeliveredAt && (
                      <div>
                        <span className="text-zinc-400 text-[10px] block uppercase">Delivered At:</span>
                        <span className="text-zinc-300">{new Date(activePatch.prDeliveredAt).toLocaleString()}</span>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-emerald-500/20 flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400">
                      AMASS submitted code fix for human review.
                    </span>
                    <a
                      href={activePatch.prUrl ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-sky-400 transition-colors"
                    >
                      View Pull Request ↗
                    </a>
                  </div>
                </div>
              ) : activePatch.prError ? (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 font-mono text-xs space-y-2 text-rose-200">
                  <div className="font-bold text-rose-400 text-sm flex items-center gap-2">
                    <span>✕</span> PR Delivery Failed
                  </div>
                  <p className="text-zinc-300 text-[11px] leading-relaxed">
                    {activePatch.prError}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-xs font-mono text-zinc-400 italic">
                  Remediation delivery will initiate automatically after Critic approves the generated patch.
                </div>
              )}

              {/* Patch Diff Reference */}
              {activePatch.diffContent ? (
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-1.5 font-mono">
                    <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                      Applied Remediation Patch Diff
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {activePatch.filePath}
                    </span>
                  </div>
                  <CodeBlock code={activePatch.diffContent} language="diff" />
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
