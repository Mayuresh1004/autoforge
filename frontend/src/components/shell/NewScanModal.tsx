import React, { useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { api } from '../../api/client';
import type { ScanModel } from '../../types/api-types';

export interface NewScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanCreated: (scan: ScanModel) => void;
}

export function NewScanModal({ isOpen, onClose, onScanCreated }: NewScanModalProps) {
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const res = await api.createStaticScan({
        repositoryUrl: repositoryUrl.trim() || undefined,
        targetPath: targetPath.trim() || undefined,
      });

      if (res.success && res.data) {
        onScanCreated(res.data);
        onClose();
        setRepositoryUrl('');
        setTargetPath('');
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
            Target Repository URL (optional)
          </label>
          <input
            type="text"
            value={repositoryUrl}
            onChange={(e) => setRepositoryUrl(e.target.value)}
            placeholder="e.g. https://github.com/OWASP/NodeGoat.git"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1">
            Local Target Path (optional fallback)
          </label>
          <input
            type="text"
            value={targetPath}
            onChange={(e) => setTargetPath(e.target.value)}
            placeholder="e.g. /workspace/sample-app"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
          <p className="font-semibold text-zinc-300 mb-1">Autonomous Execution Flow:</p>
          <p>
            Triggering a scan will initialize repository analysis, static scan, sandboxed target provisioning, Scout recon, Sniper verification, Engineer patch generation, and Critic QA validation.
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
