import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { CodeBlock } from '../ui/CodeBlock';
import type { PatchModel, FindingModel } from '../../types/api-types';

export interface PatchViewProps {
  patches: PatchModel[];
  activeFinding?: FindingModel | null;
  activeFindingId?: string | null;
}

export function PatchView({ patches, activeFinding }: PatchViewProps) {
  const targetFindingId = activeFinding?.findingId || activeFinding?.id;

  // Find patch matching active finding or default to primary patch
  const activePatch = patches.find(
    (p) => p.findingId === targetFindingId || p.patchId.includes(targetFindingId || '')
  ) ?? patches[0] ?? null;

  const patchStatusVariant =
    activePatch?.status === 'APPROVED' || activePatch?.status === 'CRITIC_VERIFIED'
      ? 'success'
      : activePatch?.status === 'APPLIED'
        ? 'info'
        : 'purple';

  const patchStatusLabel =
    activePatch?.status === 'APPROVED' || activePatch?.status === 'CRITIC_VERIFIED'
      ? '✓ CRITIC VERIFIED & APPROVED'
      : activePatch?.status === 'APPLIED'
        ? '⚙️ PATCH APPLIED TO SANDBOX'
        : activePatch?.status === 'GENERATED'
          ? '🛠️ PATCH GENERATED'
          : activePatch?.status || 'GENERATED';

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Engineer Remediation Patch</CardTitle>
          <p className="text-[11px] text-zinc-500 mt-0.5">Automated Code Defense & RAG-Assisted Patch Generation</p>
        </div>
        {activePatch ? (
          <Badge variant={patchStatusVariant}>{patchStatusLabel}</Badge>
        ) : (
          <Badge variant="outline">NO PATCH GENERATED</Badge>
        )}
      </CardHeader>

      {/* Progressive Disclosure Progression Pipeline Stepper */}
      <div className="mx-4 mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-[11px] font-mono">
        <div className="text-zinc-400 font-semibold mb-2 uppercase text-[10px] tracking-wider">
          Remediation Flow Lifecycle
        </div>
        <div className="flex flex-wrap items-center justify-between gap-1 text-[10px]">
          <span className="rounded bg-sky-500/20 text-sky-400 px-2 py-0.5 border border-sky-500/30">1. DETECTION</span>
          <span className="text-zinc-600">→</span>
          <span className="rounded bg-amber-500/20 text-amber-400 px-2 py-0.5 border border-amber-500/30">2. CONFIRMED</span>
          <span className="text-zinc-600">→</span>
          <span className="rounded bg-purple-500/20 text-purple-400 px-2 py-0.5 border border-purple-500/30">3. ENGINEER RAG</span>
          <span className="text-zinc-600">→</span>
          <span className={`rounded px-2 py-0.5 border font-bold ${activePatch?.status === 'GENERATED' ? 'bg-purple-500/20 text-purple-300 border-purple-500/50' : 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}>
            4. GENERATED
          </span>
          <span className="text-zinc-600">→</span>
          <span className={`rounded px-2 py-0.5 border font-bold ${activePatch?.status === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50' : 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}>
            5. CRITIC VERIFIED
          </span>
        </div>
      </div>

      {activeFinding && (
        <div className="mx-4 mb-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-300 font-mono">
          <span className="font-semibold block mb-0.5">Active Target: {activeFinding.title} ({activeFinding.cwe || activeFinding.id})</span>
          <span className="text-[11px] opacity-80">{activeFinding.filePath}:{activeFinding.lineStart}</span>
        </div>
      )}

      {!activePatch ? (
        <div className="p-8 text-center text-xs text-zinc-500 italic">
          {activeFinding
            ? `Remediation patch for ${activeFinding.title} has not been generated yet. Engineer agent generates defensive code patches for verified exploitable findings.`
            : 'No remediation patch generated yet. Engineer agent will generate a patch upon vulnerability confirmation.'}
        </div>
      ) : (
        <div className="space-y-4 px-4 pb-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between font-mono text-xs border-b border-zinc-800/80 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-zinc-500">Target File:</span>
                <span className="text-emerald-400 font-semibold">{activePatch.filePath}</span>
              </div>
              <Badge variant={patchStatusVariant} size="sm">{patchStatusLabel}</Badge>
            </div>

            {activePatch.explanation && (
              <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-zinc-300">
                <span className="font-semibold text-sky-400 block mb-1">RAG Context & Fix Rationale:</span>
                {activePatch.explanation}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Patch Diff Preview
                </span>
              </div>
              <CodeBlock code={activePatch.diffContent} language="diff" />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
