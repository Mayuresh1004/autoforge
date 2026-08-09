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

      {/* Discovered Endpoints Card */}
      <Card>
        <CardHeader>
          <CardTitle>Discovered Endpoints (Scout Recon)</CardTitle>
          <Badge variant="purple">{endpoints.length} Endpoints</Badge>
        </CardHeader>

        {endpoints.length === 0 ? (
          <div className="p-4 text-center text-xs text-zinc-500 italic">
            No endpoints discovered yet. Scout Recon agent will populate endpoints when run.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/80 rounded-lg border border-zinc-800 bg-zinc-900/40 max-h-64 overflow-y-auto">
            {endpoints.map((ep, idx) => {
              const targetPath = ep.path || ep.url || '';
              return (
                <div key={idx} className="flex items-center justify-between p-2.5 text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                        ep.method === 'GET'
                          ? 'bg-sky-500/20 text-sky-400'
                          : ep.method === 'POST'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-amber-500/20 text-amber-400'
                      }`}
                    >
                      {ep.method ?? 'GET'}
                    </span>
                    <span className="text-zinc-200">{targetPath}</span>
                  </div>
                  {ep.risk && (
                    <span className="rounded bg-zinc-800 px-1.5 py-0.2 text-[10px] text-amber-400 border border-zinc-700">
                      {ep.risk}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Observation Layer Preview Placeholder */}
      <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-4 text-xs text-zinc-500">
        <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-400 mb-1">
          <span>● Phase 9 Contract Viewport</span>
        </div>
        <p>
          Browser & Network observation contracts (<code className="text-sky-400 font-mono">BROWSER_NAVIGATION</code>, <code className="text-sky-400 font-mono">NETWORK_REQUEST</code>) will plug directly into this viewport when emitted by future Playwright layers.
        </p>
      </div>
    </div>
  );
}
