import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { CodeBlock } from '../ui/CodeBlock';
import type { PatchModel } from '../../types/api-types';

export interface PatchViewProps {
  patches: PatchModel[];
}

export function PatchView({ patches }: PatchViewProps) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Engineer Remediation Patch</CardTitle>
          <p className="text-[11px] text-zinc-500 mt-0.5">Automated Code Defense & RAG-Assisted Patch Generation</p>
        </div>
        <Badge variant={patches.length > 0 ? 'success' : 'outline'}>
          {patches.length} Patch Available
        </Badge>
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
          <span className="rounded bg-emerald-500/20 text-emerald-400 px-2 py-0.5 border border-emerald-500/30 font-bold">4. PATCH GENERATED</span>
          <span className="text-zinc-600">→</span>
          <span className="rounded bg-zinc-800 text-zinc-300 px-2 py-0.5 border border-zinc-700">5. CRITIC QA</span>
        </div>
      </div>

      {patches.length === 0 ? (
        <div className="p-8 text-center text-xs text-zinc-500 italic">
          No remediation patch generated yet. Engineer agent will generate a patch upon vulnerability confirmation.
        </div>
      ) : (
        <div className="space-y-4 px-4 pb-4">
          {patches.map((patch) => (
            <div key={patch.patchId} className="space-y-3">
              <div className="flex items-center justify-between font-mono text-xs border-b border-zinc-800/80 pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">Target File:</span>
                  <span className="text-emerald-400 font-semibold">{patch.filePath}</span>
                </div>
                <Badge variant="success" size="sm">{patch.status}</Badge>
              </div>

              {patch.explanation && (
                <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-zinc-300">
                  <span className="font-semibold text-sky-400 block mb-1">RAG Context & Fix Rationale:</span>
                  {patch.explanation}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Patch Diff Preview
                  </span>
                </div>
                <CodeBlock code={patch.diffContent} language="diff" />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
