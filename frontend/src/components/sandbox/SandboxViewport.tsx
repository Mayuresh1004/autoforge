import { useState } from 'react';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { api } from '../../api/client';
import type { RuntimeSandboxModel, ScoutEndpoint } from '../../types/api-types';

export interface SandboxViewportProps {
  sandbox: RuntimeSandboxModel | null;
  endpoints: ScoutEndpoint[];
}

export function SandboxViewport({ sandbox, endpoints }: SandboxViewportProps) {
  const [healthStatus, setHealthStatus] = useState<string | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);

  const handleHealthCheck = async () => {
    if (!sandbox?.sandboxId) return;
    setIsCheckingHealth(true);
    try {
      const res = await api.checkRuntimeSandboxHealth(sandbox.sandboxId);
      if (res.success && res.data) {
        setHealthStatus(res.data.healthy ? 'HEALTHY (HTTP 200)' : 'UNHEALTHY');
      } else {
        setHealthStatus(res.error?.message ?? 'Health check failed');
      }
    } catch {
      setHealthStatus('Health check failed');
    } finally {
      setIsCheckingHealth(false);
    }
  };

  const statusVariant =
    sandbox?.status === 'READY'
      ? 'success'
      : sandbox?.status === 'PROVISIONING'
        ? 'info'
        : sandbox?.status === 'FAILED'
          ? 'danger'
          : 'default';

  return (
    <div className="space-y-4">
      {/* Sandbox Container Card */}
      <Card>
        <CardHeader>
          <CardTitle>Runtime Sandbox Container</CardTitle>
          {sandbox ? (
            <Badge variant={statusVariant} size="md">
              {sandbox.status}
            </Badge>
          ) : (
            <Badge variant="outline">NO ACTIVE SANDBOX</Badge>
          )}
        </CardHeader>

        {sandbox ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
                <span className="text-zinc-500 block text-[10px] font-mono uppercase">Sandbox ID</span>
                <span className="font-mono text-zinc-200 font-medium">{sandbox.sandboxId}</span>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
                <span className="text-zinc-500 block text-[10px] font-mono uppercase">Target URL</span>
                {sandbox.targetUrl ? (
                  <a
                    href={sandbox.targetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-sky-400 hover:underline font-medium break-all"
                  >
                    {sandbox.targetUrl} ↗
                  </a>
                ) : (
                  <span className="text-zinc-500 italic">Not set</span>
                )}
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
                <span className="text-zinc-500 block text-[10px] font-mono uppercase">Runtime Backend</span>
                <span className="font-mono text-zinc-200 uppercase">{sandbox.runtime}</span>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
                <span className="text-zinc-500 block text-[10px] font-mono uppercase">HTTP Readiness</span>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-emerald-400">
                    {healthStatus ?? sandbox.healthStatus ?? 'READY'}
                  </span>
                  <Button variant="ghost" size="sm" onClick={handleHealthCheck} isLoading={isCheckingHealth}>
                    Check
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500 italic">
            Sandbox provisioning event not yet received from backend pipeline.
          </div>
        )}
      </Card>

      {/* Discovered Endpoints & Scout Finding-Aware Recon Card */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Scout Reconnaissance</CardTitle>
            <p className="text-[11px] text-zinc-500 mt-0.5">Finding-Aware Attack Surface Mapping</p>
          </div>
          <Badge variant="purple">{endpoints.length} Endpoints Mapped</Badge>
        </CardHeader>

        {endpoints.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-500 italic">
            No reconnaissance data yet. Scout agent will map discovered findings to attack surfaces.
          </div>
        ) : (
          <div className="space-y-3">
            {endpoints.map((ep) => {
              const targetPath = ep.path || ep.url || '';
              const fId = ep.findingId || 'Finding Target';
              const epKey = ep.id || (ep.findingId ? `${ep.findingId}-${ep.method}-${targetPath}` : `${ep.method}-${targetPath}`);
              const isEvidenceDone = ep.status === 'EVIDENCE_COLLECTED' || ep.status === 'COMPLETED' || Boolean(ep.evidence);

              return (
                <div key={epKey} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sky-400 text-[11px]">{fId}</span>
                      <span
                        className={`rounded px-1.5 py-0.2 font-mono text-[10px] font-bold ${
                          ep.method === 'GET'
                            ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                            : ep.method === 'POST'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {ep.method ?? 'GET'}
                      </span>
                      <span className="font-mono text-zinc-100 font-semibold">{targetPath}</span>
                    </div>

                    <div className="flex items-center gap-1.5 font-mono text-[10px]">
                      {isEvidenceDone ? (
                        <span className="text-emerald-400 font-semibold flex items-center gap-1">
                          <span>✓</span> EVIDENCE COLLECTED
                        </span>
                      ) : (
                        <span className="text-amber-400 animate-pulse font-semibold flex items-center gap-1">
                          <span>🔍</span> INVESTIGATING
                        </span>
                      )}
                    </div>
                  </div>

                  {ep.description && (
                    <div className="text-zinc-400 text-[11px] leading-relaxed">
                      {ep.description}
                    </div>
                  )}

                  {ep.evidence && (
                    <div className="rounded bg-zinc-950/80 p-2 border border-zinc-800 font-mono text-[11px] text-zinc-300">
                      <span className="text-amber-400 font-semibold block mb-0.5">Recon Evidence:</span>
                      <span>{ep.evidence}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
