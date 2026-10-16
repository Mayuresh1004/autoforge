import { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { PatchModel, FindingModel } from '../../types/api-types';
import type { AgentStatus, CriticStageState } from '../../hooks/useScanStore';

export interface PatchViewProps {
  patches: PatchModel[];
  activeFinding?: FindingModel | null;
  activeFindingId?: string | null;
  onSelectFindingId?: (findingId: string) => void;
  criticStages?: CriticStageState[];
  criticMatrix?: Record<string, CriticStageState[]>;
  engineerStatus?: AgentStatus;
  isLoading?: boolean;
}

export function PatchView({
  patches,
  activeFinding,
  onSelectFindingId,
  criticStages,
  criticMatrix,
  engineerStatus,
  isLoading,
}: PatchViewProps) {
  const [selectedPatchId, setSelectedPatchId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'unified' | 'side-by-side' | 'raw'>('unified');
  const [copied, setCopied] = useState(false);

  const targetFindingId = activeFinding?.findingId || activeFinding?.id;

  // Determine active patch based on selected patch ID or active finding ID
  const activePatch =
    patches.find(
      (p) =>
        (selectedPatchId && p.patchId === selectedPatchId) ||
        (targetFindingId && (p.findingId === targetFindingId || p.patchId.includes(targetFindingId)))
    ) ??
    patches[0] ??
    null;

  // Resolve critic stages for active finding / patch
  const resolvedCriticStages = useMemo(() => {
    if (activePatch?.findingId && criticMatrix?.[activePatch.findingId]) {
      return criticMatrix[activePatch.findingId];
    }
    if (targetFindingId && criticMatrix?.[targetFindingId]) {
      return criticMatrix[targetFindingId];
    }
    return criticStages ?? [];
  }, [activePatch, criticMatrix, criticStages, targetFindingId]);

  // Parse unified diff lines for colored rendering and stats
  const diffStats = useMemo(() => {
    if (!activePatch?.diffContent) {
      return { additions: 0, deletions: 0, lines: [] };
    }
    const rawLines = activePatch.diffContent.replace(/\r\n/g, '\n').split('\n');
    let additions = 0;
    let deletions = 0;

    const lines = rawLines.map((line, idx) => {
      let type: 'header' | 'hunk' | 'addition' | 'deletion' | 'context' = 'context';
      if (line.startsWith('---') || line.startsWith('+++')) {
        type = 'header';
      } else if (line.startsWith('@@')) {
        type = 'hunk';
      } else if (line.startsWith('+')) {
        type = 'addition';
        additions += 1;
      } else if (line.startsWith('-')) {
        type = 'deletion';
        deletions += 1;
      }
      return { line, type, idx: idx + 1 };
    });

    return { additions, deletions, lines };
  }, [activePatch?.diffContent]);

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

  const handleCopyCode = () => {
    if (!activePatch?.diffContent) return;
    navigator.clipboard.writeText(activePatch.diffContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div>
          <CardTitle>Remediation Patches & Defensive Code</CardTitle>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Canonical Patch Artifacts • RAG-Assisted Defensive Code • Verified in Critic Sandbox
          </p>
        </div>
        <div className="flex items-center gap-2">
          {engineerStatus === 'RUNNING' && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
              ENGINEER GENERATING
            </span>
          )}
          <Badge variant={patches.length > 0 ? 'purple' : 'outline'}>
            {patches.length} {patches.length === 1 ? 'Patch' : 'Patches'}
          </Badge>
        </div>
      </CardHeader>

      {/* Remediation Flow Stepper */}
      <div className="mx-4 mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-[11px] font-mono">
        <div className="text-zinc-400 font-semibold mb-2 uppercase text-[10px] tracking-wider flex items-center justify-between">
          <span>Remediation Pipeline Lifecycle</span>
          {activePatch && (
            <span className="text-zinc-500 text-[10px] normal-case">
              Active: <strong className="text-zinc-300">{activePatch.patchId}</strong>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-1 text-[10px]">
          <span className="rounded bg-sky-500/20 text-sky-400 px-2 py-0.5 border border-sky-500/30">1. DISCOVERED</span>
          <span className="text-zinc-600">→</span>
          <span className="rounded bg-amber-500/20 text-amber-400 px-2 py-0.5 border border-amber-500/30">2. PLANNED</span>
          <span className="text-zinc-600">→</span>
          <span className="rounded bg-rose-500/20 text-rose-400 px-2 py-0.5 border border-rose-500/30">3. CONFIRMED</span>
          <span className="text-zinc-600">→</span>
          <span
            className={`rounded px-2 py-0.5 border font-bold ${
              activePatch ? 'bg-purple-500/20 text-purple-300 border-purple-500/50' : 'bg-zinc-900 text-zinc-500 border-zinc-800'
            }`}
          >
            4. PATCH GENERATED
          </span>
          <span className="text-zinc-600">→</span>
          <span
            className={`rounded px-2 py-0.5 border font-bold ${
              activePatch?.status === 'CRITIC_VERIFIED' || activePatch?.status === 'APPROVED'
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                : 'bg-zinc-900 text-zinc-500 border-zinc-800'
            }`}
          >
            5. CRITIC VERIFIED
          </span>
          <span className="text-zinc-600">→</span>
          <span
            className={`rounded px-2 py-0.5 border font-bold ${
              activePatch?.prUrl || activePatch?.prNumber
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
                : 'bg-zinc-900 text-zinc-500 border-zinc-800'
            }`}
          >
            6. PR CREATED
          </span>
        </div>
      </div>

      {/* State A: Loading / In-Progress */}
      {patches.length === 0 && (isLoading || engineerStatus === 'RUNNING') && (
        <div className="m-4 p-8 rounded-xl border border-purple-500/30 bg-purple-500/5 text-center space-y-3">
          <div className="inline-block p-3 rounded-full bg-purple-500/10 text-purple-400">
            <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-purple-200">Engineer Agent Generating Defensive Patch...</h3>
          <p className="text-xs text-zinc-400 max-w-md mx-auto">
            Retrieving vulnerable source file context, querying RAG index for defensive patterns, and assembling structured unified diff.
          </p>
        </div>
      )}

      {/* State B: Failed Engineer Execution */}
      {patches.length === 0 && engineerStatus === 'FAILED' && !isLoading && (
        <div className="m-4 p-6 rounded-xl border border-rose-500/40 bg-rose-500/10 text-center space-y-2">
          <div className="text-rose-400 font-bold text-sm">❌ Remediation Generation Failed</div>
          <p className="text-xs text-zinc-300 max-w-lg mx-auto">
            The Engineer agent encountered an error or the generated patch failed structural and security review gating.
          </p>
        </div>
      )}

      {/* State C: Not Yet Generated */}
      {patches.length === 0 && engineerStatus !== 'RUNNING' && engineerStatus !== 'FAILED' && !isLoading && (
        <div className="m-4 p-8 rounded-xl border border-zinc-800 bg-zinc-900/30 text-center space-y-2 text-zinc-500">
          <div className="text-sm font-semibold text-zinc-400">No Remediation Patches Generated Yet</div>
          <p className="text-xs max-w-md mx-auto">
            The Engineer agent generates defensive code patches automatically once candidate vulnerabilities are verified by the Sniper agent.
          </p>
        </div>
      )}

      {/* State D: Patches Available */}
      {patches.length > 0 && (
        <div className="space-y-4 px-4 pb-4">
          {/* Patch Collection Selector Bar */}
          <div className="space-y-1.5 border-b border-zinc-800/80 pb-3">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1 font-mono">
              Available Remediation Patch Artifacts ({patches.length})
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
                    <div className="font-mono text-[10px] text-zinc-300 truncate">{p.filePath}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Patch Details Inspector */}
          {activePatch && (
            <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              {/* Header: Target File & Status */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
                <div className="min-w-0">
                  <span className="text-zinc-500 block text-[10px] uppercase font-semibold font-mono">Target Source File</span>
                  <span className="text-emerald-400 font-mono font-semibold text-sm break-all">
                    {activePatch.filePath ? activePatch.filePath : 'File Path Unavailable'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={patchStatusVariant} size="md">
                    {patchStatusLabel}
                  </Badge>
                </div>
              </div>

              {/* Grid: Patch Identity, Associated Finding & Agent Status */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs font-mono">
                {/* Patch & Finding Identity */}
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-zinc-500 block">Patch & Finding Identity</span>
                  <div className="text-zinc-300">
                    Patch ID: <span className="text-sky-300 font-bold">{activePatch.patchId}</span>
                  </div>
                  <div className="text-zinc-400 text-[11px]">
                    Finding ID: <span className="text-zinc-200">{activePatch.findingId || targetFindingId || 'N/A'}</span>
                  </div>
                  {activeFinding && (
                    <div className="text-zinc-300 text-[11px] pt-1 border-t border-zinc-800/60 mt-1">
                      <span className="font-semibold text-zinc-200 block truncate">{activeFinding.title}</span>
                      <span className="text-amber-400 text-[10px] font-bold">{activeFinding.cwe || activeFinding.ruleId}</span>
                      {activeFinding.severity && (
                        <span className="ml-2 text-rose-400 text-[10px] font-bold">[{activeFinding.severity}]</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Engineer Generation Status */}
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-zinc-500 block">Engineer Generation Status</span>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-300">Status:</span>
                    <span
                      className={`font-bold px-1.5 py-0.2 rounded text-[10px] ${
                        activePatch.status === 'REJECTED'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                      }`}
                    >
                      {activePatch.status === 'REJECTED' ? 'REJECTED' : 'GENERATED'}
                    </span>
                  </div>
                  <div className="text-zinc-400 text-[11px]">
                    RAG Advisory: <span className="text-zinc-200">{activePatch.ragContextCount ?? 3} doc(s) incorporated</span>
                  </div>
                  <div className="text-zinc-400 text-[11px]">
                    Diff Size: <span className="text-zinc-200">{diffStats.lines.length} lines</span>
                    <span className="text-emerald-400 ml-1">+{diffStats.additions}</span>
                    <span className="text-rose-400 ml-1">-{diffStats.deletions}</span>
                  </div>
                </div>

                {/* Critic Validation Summary */}
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-zinc-500 block">Critic Validation Verdict</span>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-300">Verdict:</span>
                    <span
                      className={`font-bold px-1.5 py-0.2 rounded text-[10px] ${
                        activePatch.status === 'APPROVED' || activePatch.status === 'CRITIC_VERIFIED'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : activePatch.status === 'REJECTED'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : 'bg-zinc-800 text-zinc-300'
                      }`}
                    >
                      {activePatch.status === 'APPROVED' || activePatch.status === 'CRITIC_VERIFIED'
                        ? '✓ APPROVED'
                        : activePatch.status === 'REJECTED'
                          ? '❌ REJECTED'
                          : 'UNDER REVIEW'}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Sandbox QA: <span className="text-zinc-200">{resolvedCriticStages.filter((s) => s.status === 'PASSED').length}/{resolvedCriticStages.length || 6} stages passed</span>
                  </div>
                </div>
              </div>

              {/* Critic QA 6-Stage Checklist */}
              {resolvedCriticStages.length > 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                  <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider font-mono mb-2">
                    Critic QA Validation Test Suite Results
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 text-[10px] font-mono">
                    {resolvedCriticStages.map((stage) => {
                      const isPassed = stage.status === 'PASSED';
                      const isFailed = stage.status === 'FAILED';
                      const isRunning = stage.status === 'RUNNING';
                      return (
                        <div
                          key={stage.key}
                          className={`rounded border p-2 ${
                            isPassed
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                              : isFailed
                                ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                                : isRunning
                                  ? 'border-sky-500/30 bg-sky-500/10 text-sky-300 animate-pulse'
                                  : 'border-zinc-800 bg-zinc-900/40 text-zinc-500'
                          }`}
                        >
                          <div className="font-bold flex items-center gap-1">
                            <span>{isPassed ? '✓' : isFailed ? '✗' : isRunning ? '⚙️' : '○'}</span>
                            <span className="truncate">{stage.name}</span>
                          </div>
                          <div className="text-[9px] text-zinc-400 mt-1 capitalize">{stage.status.toLowerCase()}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* RAG Context & Remediation Rationale */}
              {activePatch.explanation && (
                <div
                  className={`rounded-lg border p-3 text-xs ${
                    activePatch.status === 'REJECTED'
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                      : 'border-sky-500/30 bg-sky-500/10 text-zinc-200'
                  }`}
                >
                  <span
                    className={`font-semibold block mb-1 font-mono ${
                      activePatch.status === 'REJECTED' ? 'text-rose-400' : 'text-sky-400'
                    }`}
                  >
                    {activePatch.status === 'REJECTED' ? 'Rejection Reason:' : 'RAG Context & Remediation Rationale:'}
                  </span>
                  <p className="leading-relaxed text-zinc-300">{activePatch.explanation}</p>
                </div>
              )}

              {/* Pull Request Delivery Card */}
              {(activePatch.prUrl || activePatch.prNumber || activePatch.prError) && (
                <div
                  className={`rounded-lg border p-3 text-xs font-mono space-y-2 ${
                    activePatch.prError
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      {activePatch.prError
                        ? '⚠️ Remediation Delivery Notice'
                        : activePatch.prUrl
                          ? '🚀 GitHub Pull Request Created'
                          : '🧪 Simulated Pull Request (Demo)'}
                    </span>
                    {activePatch.prStatus && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9px] font-bold">
                        {activePatch.prStatus}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                    {activePatch.prUrl ? (
                      <div>
                        <a
                          href={activePatch.prUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-400 hover:text-sky-300 underline font-semibold flex items-center gap-1"
                        >
                          View Pull Request #{activePatch.prNumber} ↗
                        </a>
                      </div>
                    ) : activePatch.prNumber ? (
                      <div className="text-zinc-400">
                        Simulated PR #{activePatch.prNumber} (demo fixture)
                      </div>
                    ) : null}

                    {activePatch.prBranch && (
                      <div className="text-zinc-400">
                        Head Branch: <span className="text-zinc-200 font-semibold">{activePatch.prBranch}</span>
                      </div>
                    )}

                    {activePatch.prCommitSha && (
                      <div className="text-zinc-400">
                        Commit: <span className="text-zinc-200 font-semibold">{activePatch.prCommitSha.slice(0, 10)}</span>
                      </div>
                    )}

                    {activePatch.prBaseBranch && (
                      <div className="text-zinc-400">
                        Base: <span className="text-zinc-200 font-semibold">{activePatch.prBaseBranch}</span>
                      </div>
                    )}
                  </div>

                  {activePatch.prError && (
                    <div className="text-[11px] text-amber-300 border-t border-amber-500/30 pt-1.5 mt-1.5">
                      Delivery Notice: {activePatch.prError}
                    </div>
                  )}
                </div>
              )}

              {/* Source Diff & Code Changes Panel */}
              {activePatch.diffContent ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-2 font-mono">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                        Source Code Changes
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                        +{diffStats.additions}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-bold">
                        -{diffStats.deletions}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex rounded border border-zinc-800 bg-zinc-950 p-0.5 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setViewMode('unified')}
                          className={`px-2 py-0.5 rounded transition-colors ${
                            viewMode === 'unified' ? 'bg-zinc-800 text-zinc-100 font-bold' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          Unified Diff
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode('raw')}
                          className={`px-2 py-0.5 rounded transition-colors ${
                            viewMode === 'raw' ? 'bg-zinc-800 text-zinc-100 font-bold' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          Raw Diff
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={handleCopyCode}
                        className="text-[11px] font-mono px-2 py-1 rounded border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                      >
                        {copied ? '✓ Copied' : 'Copy Diff'}
                      </button>
                    </div>
                  </div>

                  {viewMode === 'unified' ? (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 font-mono text-xs overflow-x-auto max-h-[500px]">
                      <div className="divide-y divide-zinc-900/60 font-mono text-[12px] leading-relaxed">
                        {diffStats.lines.map(({ line, type, idx }) => {
                          if (type === 'header') {
                            return (
                              <div key={idx} className="px-3 py-1 bg-zinc-900/80 text-zinc-400 font-bold text-[11px]">
                                {line}
                              </div>
                            );
                          }
                          if (type === 'hunk') {
                            return (
                              <div key={idx} className="px-3 py-1 bg-sky-950/40 text-sky-300 font-semibold text-[11px] border-l-2 border-sky-500">
                                {line}
                              </div>
                            );
                          }
                          if (type === 'addition') {
                            return (
                              <div key={idx} className="flex px-3 py-0.5 bg-emerald-950/30 text-emerald-300 border-l-2 border-emerald-500">
                                <span className="select-none text-zinc-600 w-8 text-right pr-2 text-[10px]">{idx}</span>
                                <span className="select-none pr-2 font-bold">+</span>
                                <span className="whitespace-pre">{line.slice(1)}</span>
                              </div>
                            );
                          }
                          if (type === 'deletion') {
                            return (
                              <div key={idx} className="flex px-3 py-0.5 bg-rose-950/30 text-rose-300 border-l-2 border-rose-500">
                                <span className="select-none text-zinc-600 w-8 text-right pr-2 text-[10px]">{idx}</span>
                                <span className="select-none pr-2 font-bold">-</span>
                                <span className="whitespace-pre">{line.slice(1)}</span>
                              </div>
                            );
                          }
                          return (
                            <div key={idx} className="flex px-3 py-0.5 text-zinc-300 hover:bg-zinc-900/40">
                              <span className="select-none text-zinc-600 w-8 text-right pr-2 text-[10px]">{idx}</span>
                              <span className="select-none pr-2 text-zinc-600"> </span>
                              <span className="whitespace-pre">{line.startsWith(' ') ? line.slice(1) : line}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="relative rounded-lg border border-zinc-800 bg-zinc-950 font-mono text-xs overflow-x-auto max-h-[500px] p-3 text-zinc-300 whitespace-pre">
                      {activePatch.diffContent}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-6 text-center text-xs text-zinc-500 font-mono">
                  No source diff content available for this patch artifact.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
