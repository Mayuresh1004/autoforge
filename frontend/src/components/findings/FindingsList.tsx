import { useState } from 'react';
import { FindingCard } from './FindingCard';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { FindingModel, VulnerabilitySeverity } from '../../types/api-types';

export interface FindingsListProps {
  findings: FindingModel[];
  activeFindingId?: string | null;
  onSelectFinding?: (finding: FindingModel) => void;
}

export function FindingsList({ findings, activeFindingId, onSelectFinding }: FindingsListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<VulnerabilitySeverity | 'ALL'>('ALL');

  const handleSelect = (finding: FindingModel) => {
    setSelectedId(finding.id);
    onSelectFinding?.(finding);
  };

  const currentSelectedId = selectedId ?? activeFindingId;

  const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length;
  const highCount = findings.filter((f) => f.severity === 'HIGH').length;
  const mediumCount = findings.filter((f) => f.severity === 'MEDIUM').length;
  const lowCount = findings.filter((f) => f.severity === 'LOW').length;

  const confirmedCount = findings.filter((f) => f.isConfirmed || f.status === 'EXPLOIT_CONFIRMED' || f.status === 'CONFIRMED' || f.status === 'REMEDIATION' || f.status === 'PATCHED' || f.status === 'CRITIC_VERIFIED').length;
  const remediatedCount = findings.filter((f) => f.status === 'CRITIC_VERIFIED' || f.status === 'PATCHED').length;

  const filteredFindings = severityFilter === 'ALL'
    ? findings
    : findings.filter((f) => f.severity === severityFilter);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div>
          <CardTitle>Vulnerability Findings</CardTitle>
          <p className="text-[11px] text-zinc-500 mt-0.5 font-mono">
            {findings.length} Discovered · {confirmedCount} Confirmed · {remediatedCount} Remediated
          </p>
        </div>
        <Badge variant="purple">{findings.length} Total</Badge>
      </CardHeader>

      {/* Severity Summary Pills */}
      <div className="px-4 pb-3 flex flex-wrap items-center gap-1.5 border-b border-zinc-800 text-[10px] font-mono">
        <button
          onClick={() => setSeverityFilter('ALL')}
          className={`px-2 py-0.5 rounded border transition-colors ${
            severityFilter === 'ALL'
              ? 'bg-zinc-800 text-zinc-100 border-zinc-600 font-bold'
              : 'bg-zinc-900/60 text-zinc-400 border-zinc-800 hover:text-zinc-200'
          }`}
        >
          ALL ({findings.length})
        </button>

        {criticalCount > 0 && (
          <button
            onClick={() => setSeverityFilter('CRITICAL')}
            className={`px-2 py-0.5 rounded border transition-colors ${
              severityFilter === 'CRITICAL'
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 font-bold'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20'
            }`}
          >
            CRITICAL ({criticalCount})
          </button>
        )}

        {highCount > 0 && (
          <button
            onClick={() => setSeverityFilter('HIGH')}
            className={`px-2 py-0.5 rounded border transition-colors ${
              severityFilter === 'HIGH'
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-bold'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20'
            }`}
          >
            HIGH ({highCount})
          </button>
        )}

        {mediumCount > 0 && (
          <button
            onClick={() => setSeverityFilter('MEDIUM')}
            className={`px-2 py-0.5 rounded border transition-colors ${
              severityFilter === 'MEDIUM'
                ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50 font-bold'
                : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20'
            }`}
          >
            MEDIUM ({mediumCount})
          </button>
        )}

        {lowCount > 0 && (
          <button
            onClick={() => setSeverityFilter('LOW')}
            className={`px-2 py-0.5 rounded border transition-colors ${
              severityFilter === 'LOW'
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/50 font-bold'
                : 'bg-sky-500/10 text-sky-400 border-sky-500/20 hover:bg-sky-500/20'
            }`}
          >
            LOW ({lowCount})
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 p-3 min-h-[300px]">
        {filteredFindings.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500 italic">
            {findings.length === 0
              ? 'No findings discovered yet. Static Scanner will populate findings.'
              : 'No findings matching current filter.'}
          </div>
        ) : (
          filteredFindings.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              isSelected={f.id === currentSelectedId}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>
    </Card>
  );
}
