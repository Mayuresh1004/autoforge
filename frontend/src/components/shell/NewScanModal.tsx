import React, { useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { getAMASSDataProvider } from '../../providers';
import type { ApiResponse, ScanModel } from '../../types/api-types';

export interface NewScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanCreated?: (scan: ScanModel) => void;
  onStartScan?: (options: { repositoryUrl: string }) => Promise<ApiResponse<ScanModel>>;
}

export function NewScanModal({ isOpen, onClose, onScanCreated, onStartScan }: NewScanModalProps) {
  const [targetUrl, setTargetUrl] = useState('https://github.com/Mayuresh1004/AskBit');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalUrl = targetUrl.trim();
    if (!finalUrl) {
      setError('Target URL is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const provider = getAMASSDataProvider();
      const res = onStartScan
        ? await onStartScan({ repositoryUrl: finalUrl })
        : await provider.startScan({ repositoryUrl: finalUrl });

      if (res.success && res.data) {
        if (onScanCreated) onScanCreated(res.data);
        onClose();
      } else {
        setError(res.error?.message ?? 'Failed to trigger scan');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error creating scan');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Trigger New AMASS Security Scan">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1">
            Target Repository URL
          </label>
          <input
            type="text"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="e.g. https://github.com/Mayuresh1004/AskBit"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-sky-500 focus:outline-hidden"
            required
          />
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400 space-y-1">
          <p className="font-semibold text-zinc-300">Autonomous Pipeline Workflow:</p>
          <p>
            Triggers Analyzer static analysis, Scout recon, Attack Planner target prioritization, Sniper verification, Engineer patching, and Critic QA validation.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isLoading}>
            Run Autonomous Scan
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
