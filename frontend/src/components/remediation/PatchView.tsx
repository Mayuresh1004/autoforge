import { useState } from 'react';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { CodeBlock } from '../ui/CodeBlock';
import type { PatchModel, FindingModel } from '../../types/api-types';

export interface PatchViewProps {
  patches: PatchModel[];
  activeFinding?: FindingModel | null;
  activeFindingId?: string | null;
  onSelectFindingId?: (findingId: string) => void;
}

export function PatchView({ patches, activeFinding, onSelectFindingId }: PatchViewProps) {
  const [selectedPatchId, setSelectedPatchId] = useState<string | null>(null);

  const targetFindingId = activeFinding?.findingId || activeFinding?.id;

  // Determine active patch based on selected patch ID or active finding ID
  const activePatch = patches.find(
    (p) =>
      (selectedPatchId && p.patchId === selectedPatchId) ||
      (targetFindingId && (p.findingId === targetFindingId || p.patchId.includes(targetFindingId)))
  ) ?? patches[0] ?? null;

  const patchStatusVariant =
    activePatch?.status === 'APPROVED' || activePatch?.status === 'CRITIC_VERIFIED'
      ? 'success'
      : activePatch?.status === 'APPLIED'
        ? 'info'
        : activePatch?.status === 'REJECTED'
          ? 'danger'
          : 'purple';

  const patchStatusLabel =
    activePatch?.status === 'APPROVED' || activePatch?.status === 'CRITIC_VERIFIED'
      ? '✓ CRITIC VERIFIED'
      : activePatch?.status === 'APPLIED'
        ? '⚙️ PATCH APPLIED'
        : activePatch?.status === 'REJECTED'
          ? '❌ PATCH REJECTED'
          : activePatch?.status === 'GENERATED' || activePatch?.status === 'PATCH_GENERATED'
            ? '🛠️ PATCH GENERATED'
            : activePatch?.status || 'PATCH GENERATED';

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Remediation Patches</CardTitle>
          <p className="text-[11px] text-zinc-500 mt-0.5">Automated Defensive Code Patches & RAG-Assisted Remediation</p>
        </div>
        <Badge variant={patches.length > 0 ? 'purple' : 'outline'}>
          {patches.length} {patches.length === 1 ? 'Patch' : 'Patches'}
        </Badge>
      </CardHeader>

      {/* Remediation Flow Stepper */}
      <div className="mx-4 mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-[11px] font-mono">
        <div className="text-zinc-400 font-semibold mb-2 uppercase text-[10px] tracking-wider">
          Remediation Pipeline Lifecycle
        </div>
        <div className="flex flex-wrap items-center justify-between gap-1 text-[10px]">
          <span className="rounded bg-sky-500/20 text-sky-400 px-2 py-0.5 border border-sky-500/30">1. DISCOVERED</span>
          <span className="text-zinc-600">→</span>
          <span className="rounded bg-amber-500/20 text-amber-400 px-2 py-0.5 border border-amber-500/30">2. PLANNED</span>
          <span className="text-zinc-600">→</span>
          <span className="rounded bg-rose-500/20 text-rose-400 px-2 py-0.5 border border-rose-500/30">3. CONFIRMED</span>
          <span className="text-zinc-600">→</span>
          <span className={`rounded px-2 py-0.5 border font-bold ${activePatch ? 'bg-purple-500/20 text-purple-300 border-purple-500/50' : 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}>
            4. PATCH GENERATED
          </span>
          <span className="text-zinc-600">→</span>
          <span className={`rounded px-2 py-0.5 border font-bold ${activePatch?.status === 'CRITIC_VERIFIED' || activePatch?.status === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50' : 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}>
            5. CRITIC VERIFIED
          </span>
          <span className="text-zinc-600">→</span>
          <span className={`rounded px-2 py-0.5 border font-bold ${activePatch?.prUrl || activePatch?.prNumber ? 'bg-sky-500/20 text-sky-300 border-sky-500/50' : 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}>
            6. PR CREATED
          </span>
        </div>
      </div>

      {patches.length === 0 ? (
        <div className="p-8 text-center text-xs text-zinc-500 italic">
          No remediation patches generated yet. Engineer agent will generate defensive code patches after Sniper verification completes.
        </div>
      ) : (
        <div className="space-y-4 px-4 pb-4">
          {/* Patch Collection Bar / Cards */}
          <div className="space-y-1.5 border-b border-zinc-800/80 pb-3">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1 font-mono">
              Generated Remediation Records ({patches.length})
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {patches.map((p) => {
                const isSelected = activePatch?.patchId === p.patchId;
                const shortId = (p.findingId || p.patchId).replace('fnd-', '').replace('patch-', '').toUpperCase();
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
                          p.status === 'CRITIC_VERIFIED' || p.status === 'APPROVED'
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                            : p.status === 'REJECTED'
                              ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                              : 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                        }`}
                      >
                        {p.status === 'CRITIC_VERIFIED' || p.status === 'APPROVED' ? 'APPROVED' : p.status === 'REJECTED' ? 'REJECTED' : 'GENERATED'}
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

          {/* Active Patch Details Inspector */}
          {activePatch && (
            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex items-center justify-between font-mono text-xs border-b border-zinc-800/80 pb-2">
                <div>
                  <span className="text-zinc-500 block text-[10px] uppercase font-semibold">Target File</span>
                  <span className="text-emerald-400 font-semibold text-sm">
                    {activePatch.filePath ? activePatch.filePath : 'File Path Unavailable'}
                  </span>
                </div>
                <Badge variant={patchStatusVariant} size="md">
                  {patchStatusLabel}
                </Badge>
              </div>

              {activePatch.explanation && (
                <div className={`rounded-lg border p-3 text-xs ${activePatch.status === 'REJECTED' ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-sky-500/30 bg-sky-500/10 text-zinc-200'}`}>
                  <span className={`font-semibold block mb-1 font-mono ${activePatch.status === 'REJECTED' ? 'text-rose-400' : 'text-sky-400'}`}>
                    {activePatch.status === 'REJECTED' ? 'Rejection Reason:' : 'RAG Context & Remediation Rationale:'}
                  </span>
                  <p className="leading-relaxed text-zinc-300">{activePatch.explanation}</p>
                </div>
              )}

              {(activePatch.prUrl || activePatch.prNumber || activePatch.prError) && (
                <div className={`rounded-lg border p-3 text-xs font-mono space-y-1.5 ${activePatch.prError ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      {activePatch.prError ? '⚠️ Remediation Delivery Warning' : '🚀 GitHub Pull Request Created'}
                    </span>
                    {activePatch.prStatus && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9px] font-bold">
                        {activePatch.prStatus}
                      </span>
                    )}
                  </div>

                  {activePatch.prUrl ? (
                    <div className="text-xs">
                      <a
                        href={activePatch.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-400 hover:text-sky-300 underline font-semibold flex items-center gap-1"
                      >
                        View Pull Request #{activePatch.prNumber} ↗
                      </a>
                    </div>
                  ) : null}

                  {activePatch.prBranch && (
                    <div className="text-[10px] text-zinc-400">
                      Branch: <span className="text-zinc-200">{activePatch.prBranch}</span>
                    </div>
                  )}

                  {activePatch.prError && (
                    <div className="text-[11px] text-amber-300">
                      Delivery error: {activePatch.prError}
                    </div>
                  )}
                </div>
              )}

              {activePatch.diffContent ? (
                <div>
                  <div className="flex items-center justify-between mb-1.5 font-mono">
                    <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                      Patch Diff Preview
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      Patch ID: {activePatch.patchId}
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
