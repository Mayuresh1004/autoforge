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
  const displayFile = finding.filePath || finding.file || 'workspace';
  const displayLine = finding.lineStart ?? finding.line ?? 1;
  const displayEvidence = finding.description || finding.evidence || finding.snippet || '';

  return (
    <div
      onClick={() => onSelect?.(finding)}
      className={`rounded-xl border p-3 transition-all cursor-pointer ${
        isSelected
          ? 'border-sky-500 bg-sky-500/10 shadow-md shadow-sky-500/10'
          : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900'
      }`}
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
        <div className="flex items-center gap-1.5">
          <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${sevStyle.bg} ${sevStyle.text} ${sevStyle.border}`}>
            {finding.severity}
          </span>
        </div>

        {finding.status === 'CRITIC_VERIFIED' ? (
          <Badge variant="success" size="sm" className="text-[10px]">
            ✓ CRITIC VERIFIED
          </Badge>
        ) : finding.status === 'CRITIC_REJECTED' ? (
          <Badge variant="danger" size="sm" className="text-[10px]">
            ❌ CRITIC REJECTED
          </Badge>
        ) : finding.status === 'PATCHED' || finding.status === 'PATCH_GENERATED' ? (
          <Badge variant="purple" size="sm" className="text-[10px]">
            🛠️ PATCH GENERATED
          </Badge>
        ) : finding.status === 'REMEDIATION' ? (
          <Badge variant="warning" size="sm" className="text-[10px]">
            ⚡ REMEDIATION
          </Badge>
        ) : finding.isConfirmed || finding.status === 'EXPLOIT_CONFIRMED' || finding.status === 'CONFIRMED' ? (
          <Badge variant="danger" size="sm" className="text-[10px]">
            🎯 CONFIRMED
          </Badge>
        ) : finding.status === 'NOT_CONFIRMED' || finding.status === 'EXPLOIT_REJECTED' ? (
          <Badge variant="outline" size="sm" className="text-[10px] text-zinc-400">
            ⚪ NOT CONFIRMED
          </Badge>
        ) : finding.status === 'NOT_TESTED' ? (
          <Badge variant="outline" size="sm" className="text-[10px] text-amber-400/90 border-amber-500/30">
            ⏸️ NOT TESTED
          </Badge>
        ) : finding.status === 'VERIFYING' ? (
          <Badge variant="warning" size="sm" className="text-[10px] animate-pulse">
            🔍 VERIFYING
          </Badge>
        ) : finding.status === 'PLANNED' ? (
          <Badge variant="info" size="sm" className="text-[10px]">
            📋 PLANNED
          </Badge>
        ) : (
          <Badge variant="outline" size="sm" className="font-mono text-[9px]">
            DISCOVERED
          </Badge>
        )}
      </div>

      <h4 className="text-xs font-semibold text-zinc-100 mb-1 leading-snug break-words">
        {displayTitle}
      </h4>

      {displayEvidence && (
        <p className="text-[10px] text-zinc-400 line-clamp-2 mb-2 font-mono bg-zinc-950/60 p-1.5 rounded border border-zinc-800/80 leading-relaxed">
          {displayEvidence}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px] font-mono text-zinc-500 border-t border-zinc-800/60 pt-1.5">
        <span className="truncate max-w-[180px] text-zinc-400">
          {displayFile}:{displayLine}
        </span>
        {finding.cwe && (
          <span className="text-amber-400/90 font-mono">{finding.cwe}</span>
        )}
        {finding.endpoint && (
          <span className="text-sky-400 truncate max-w-[110px]">{finding.endpoint}</span>
        )}
      </div>
    </div>
  );
}
