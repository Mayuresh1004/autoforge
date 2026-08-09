import { useState } from 'react';
import { FindingCard } from './FindingCard';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { FindingModel } from '../../types/api-types';

export interface FindingsListProps {
  findings: FindingModel[];
  onSelectFinding?: (finding: FindingModel) => void;
}

export function FindingsList({ findings, onSelectFinding }: FindingsListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = (finding: FindingModel) => {
    setSelectedId(finding.id);
    onSelectFinding?.(finding);
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle>Vulnerability Findings</CardTitle>
        <Badge variant="purple">{findings.length} Discovered</Badge>
      </CardHeader>

      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-[300px]">
        {findings.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500 italic">
            No vulnerabilities detected yet. Trigger a static scan to discover vulnerabilities.
          </div>
        ) : (
          findings.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              isSelected={f.id === selectedId}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>
    </Card>
  );
}
