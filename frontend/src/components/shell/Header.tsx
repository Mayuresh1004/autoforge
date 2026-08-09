import { useState } from 'react';
import { Button } from '../ui/Button';
import { StatusPill } from './StatusPill';
import { NewScanModal } from './NewScanModal';
import type { SseConnectionStatus } from '../../types/amass-events';
import type { ScanModel } from '../../types/api-types';

export interface HeaderProps {
  activeScanId: string | null;
  scanStatus: string;
  connectionStatus: SseConnectionStatus;
  scansList?: ScanModel[];
  onSelectScan: (scanId: string) => void;
  onScanCreated: (scan: ScanModel) => void;
}

export function Header({
  activeScanId,
  scanStatus,
  connectionStatus,
  onSelectScan,
  onScanCreated,
}: HeaderProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/90 px-6 py-3 backdrop-blur-md sticky top-0 z-40">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Branding & Logo */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400 font-mono text-sm font-bold shadow-xs">
            A
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-zinc-100">AMASS</h1>
              <span className="rounded-md bg-zinc-800 px-1.5 py-0.2 font-mono text-[10px] text-zinc-400 border border-zinc-700">
                v0.1.0-sec console
              </span>
            </div>
            <p className="text-[11px] text-zinc-500">Autonomous Multi-Agent Security System</p>
          </div>
        </div>

        {/* Active Scan Indicator & Controls */}
        <div className="flex items-center gap-3">
          {activeScanId ? (
            <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs">
              <span className="text-zinc-500 font-mono">Scan:</span>
              <span className="font-mono font-medium text-sky-400">{activeScanId}</span>
              <span className="text-zinc-600">|</span>
              <span
                className={`font-mono text-[11px] uppercase font-semibold ${
                  scanStatus === 'RUNNING'
                    ? 'text-sky-400'
                    : scanStatus === 'COMPLETED'
                      ? 'text-emerald-400'
                      : scanStatus === 'FAILED'
                        ? 'text-rose-400'
                        : 'text-zinc-400'
                }`}
              >
                ● {scanStatus}
              </span>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-1 text-xs text-zinc-500 italic">
              No active scan selected
            </div>
          )}

          <StatusPill status={connectionStatus} />

          <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)}>
            + New Scan
          </Button>
        </div>
      </div>

      <NewScanModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onScanCreated={(newScan) => {
          onScanCreated(newScan);
          onSelectScan(newScan.id);
        }}
      />
    </header>
  );
}
