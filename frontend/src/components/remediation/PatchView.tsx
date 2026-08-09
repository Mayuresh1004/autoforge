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
        <CardTitle>Engineer Remediation Patch</CardTitle>
        <Badge variant={patches.length > 0 ? 'success' : 'outline'}>
          {patches.length} Patch Generated
        </Badge>
      </CardHeader>

      {patches.length === 0 ? (
        <div className="p-6 text-center text-xs text-zinc-500 italic">
          No remediation patch generated yet. Engineer agent will generate a patch upon vulnerability discovery.
        </div>
      ) : (
        <div className="space-y-4">
          {patches.map((patch) => (
            <div key={patch.patchId} className="space-y-3">
              <div className="flex items-center justify-between font-mono text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">File:</span>
                  <span className="text-emerald-400 font-semibold">{patch.filePath}</span>
                </div>
                <Badge variant="success">{patch.status}</Badge>
              </div>

              {patch.explanation && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-300">
                  <span className="font-semibold text-zinc-200 block mb-1">Patch Rationale:</span>
                  {patch.explanation}
                </div>
              )}

              <div>
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
                  Unified Git Diff
                </span>
                <CodeBlock code={patch.diffContent} language="diff" />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
