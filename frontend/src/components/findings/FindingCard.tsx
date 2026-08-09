import { Badge } from '../ui/Badge';
import { SEVERITY_COLORS } from '../../utils/theme';
import type { FindingModel } from '../../types/api-types';

export interface FindingCardProps {
  finding: FindingModel;
  isSelected?: boolean;
  onSelect?: (finding: FindingModel) => void;
}

export function FindingCard({ finding, isSelected = false, onSelect }: FindingCardProps) {
  const sevStyle = SEVERITY_COLORS[finding.severity] ?? SEVERITY_COLORS.INFO;

  const displayTitle = finding.title || finding.message || finding.type || 'Vulnerability Finding';
  const displayRule = finding.ruleId || finding.type || finding.scanner || 'VULN';
  const displayFile = finding.filePath || finding.file || 'workspace';
  const displayLine = finding.lineStart ?? finding.line ?? 1;
  const displayEvidence = finding.description || finding.evidence || finding.snippet || '';

  return (
    <div
      onClick={() => onSelect?.(finding)}
      className={`rounded-xl border p-3.5 transition-all cursor-pointer ${
        isSelected
          ? 'border-sky-500 bg-sky-500/10 shadow-md shadow-sky-500/10'
          : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900'
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
        <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${sevStyle.bg} ${sevStyle.text} ${sevStyle.border}`}>
          {finding.severity}
        </span>

        {finding.isConfirmed ? (
          <Badge variant="danger" size="sm">
            🎯 EXPLOIT CONFIRMED
          </Badge>
        ) : (
          <Badge variant="outline" size="sm" className="font-mono text-[10px]">
            {displayRule}
          </Badge>
        )}
      </div>

      <h4 className="text-xs font-semibold text-zinc-100 mb-1.5 leading-snug break-words">
        {displayTitle}
      </h4>

      {displayEvidence && (
        <p className="text-[11px] text-zinc-400 line-clamp-2 mb-2.5 font-mono bg-zinc-950/60 p-1.5 rounded border border-zinc-800/80">
          {displayEvidence}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-zinc-500 border-t border-zinc-800/60 pt-2">
        <span className="truncate max-w-[200px] text-zinc-400">
          {displayFile}:{displayLine}
        </span>
        {finding.cwe && (
          <span className="text-amber-400/80 font-mono">{finding.cwe}</span>
        )}
        {finding.endpoint && (
          <span className="text-sky-400 truncate max-w-[120px]">{finding.endpoint}</span>
        )}
      </div>
    </div>
  );
}
