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

  return (
    <div
      onClick={() => onSelect?.(finding)}
      className={`rounded-xl border p-3.5 transition-all cursor-pointer ${
        isSelected
          ? 'border-sky-500 bg-sky-500/10 shadow-md shadow-sky-500/10'
          : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${sevStyle.bg} ${sevStyle.text} ${sevStyle.border}`}>
          {finding.severity}
        </span>

        {finding.isConfirmed ? (
          <Badge variant="danger" size="sm">
            🎯 EXPLOIT CONFIRMED
          </Badge>
        ) : (
          <Badge variant="outline" size="sm">
            {finding.ruleId}
          </Badge>
        )}
      </div>

      <h4 className="text-xs font-semibold text-zinc-100 mb-1 leading-snug">{finding.title}</h4>

      <p className="text-[11px] text-zinc-400 line-clamp-2 mb-2">{finding.description}</p>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-zinc-500 border-t border-zinc-800/60 pt-2">
        <span className="truncate max-w-[180px]">{finding.filePath}:{finding.lineStart}</span>
        {finding.endpoint && (
          <span className="text-sky-400 truncate max-w-[120px]">{finding.endpoint}</span>
        )}
      </div>
    </div>
  );
}
