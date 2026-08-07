import { useEffect, useState } from 'react';

interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
  timestamp: string;
}

interface HealthData {
  status: string;
  service: string;
  version: string;
  uptime: number;
}

interface VersionData {
  name: string;
  version: string;
  environment: string;
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const AGENTS_URL = import.meta.env.VITE_AGENTS_URL ?? 'http://localhost:8000';

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    healthy: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    degraded: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    unhealthy: 'bg-red-500/20 text-red-400 border-red-500/30',
    up: 'bg-emerald-500/20 text-emerald-400',
    down: 'bg-red-500/20 text-red-400',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-gray-500/20 text-gray-400'}`}
    >
      {status}
    </span>
  );
}

function ServiceCard({
  title,
  url,
  health,
  version,
}: {
  title: string;
  url: string;
  health: HealthData | null;
  version: VersionData | null;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {health && <StatusBadge status={health.status} />}
      </div>
      <p className="mb-4 font-mono text-sm text-gray-500">{url}</p>
      {version && (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Version</span>
            <span className="font-mono text-gray-200">{version.version}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Environment</span>
            <span className="font-mono text-gray-200">{version.environment}</span>
          </div>
          {health && (
            <div className="flex justify-between">
              <span className="text-gray-400">Uptime</span>
              <span className="font-mono text-gray-200">{health.uptime}s</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [backendHealth, setBackendHealth] = useState<HealthData | null>(null);
  const [backendVersion, setBackendVersion] = useState<VersionData | null>(null);
  const [agentsHealth, setAgentsHealth] = useState<HealthData | null>(null);
  const [agentsVersion, setAgentsVersion] = useState<VersionData | null>(null);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const [healthRes, versionRes] = await Promise.all([
          fetch(`${API_URL}/health`),
          fetch(`${API_URL}/version`),
        ]);
        const healthJson: ApiResponse<HealthData> = await healthRes.json();
        const versionJson: ApiResponse<VersionData> = await versionRes.json();
        if (healthJson.success) setBackendHealth(healthJson.data);
        if (versionJson.success) setBackendVersion(versionJson.data);
      } catch {
        /* services may not be running yet */
      }

      try {
        const [healthRes, versionRes] = await Promise.all([
          fetch(`${AGENTS_URL}/health`),
          fetch(`${AGENTS_URL}/version`),
        ]);
        const healthJson: ApiResponse<HealthData> = await healthRes.json();
        const versionJson: ApiResponse<VersionData> = await versionRes.json();
        if (healthJson.success) setAgentsHealth(healthJson.data);
        if (versionJson.success) setAgentsVersion(versionJson.data);
      } catch {
        /* services may not be running yet */
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-amass-950">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <header className="mb-12 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amass-500/30 bg-amass-500/10 px-4 py-1.5 text-sm text-amass-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amass-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amass-500" />
            </span>
            Infrastructure Phase
          </div>
          <h1 className="mb-3 text-4xl font-bold tracking-tight text-white md:text-5xl">
            AMASS
          </h1>
          <p className="text-lg text-gray-400">
            Autonomous Multi-Agent Security System
          </p>
        </header>

        <div className="mb-12 grid gap-6 md:grid-cols-2">
          <ServiceCard
            title="Backend API"
            url={API_URL}
            health={backendHealth}
            version={backendVersion}
          />
          <ServiceCard
            title="AI Agents Service"
            url={AGENTS_URL}
            health={agentsHealth}
            version={agentsVersion}
          />
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-8">
          <h2 className="mb-4 text-xl font-semibold text-white">System Architecture</h2>
          <div className="grid gap-3 text-sm text-gray-400 md:grid-cols-3">
            <div className="rounded-lg border border-gray-800 p-4">
              <h3 className="mb-2 font-medium text-amass-400">Detection</h3>
              <p>Scout Agent — vulnerability discovery</p>
            </div>
            <div className="rounded-lg border border-gray-800 p-4">
              <h3 className="mb-2 font-medium text-amass-400">Exploitation</h3>
              <p>Sniper Agent — exploitability confirmation</p>
            </div>
            <div className="rounded-lg border border-gray-800 p-4">
              <h3 className="mb-2 font-medium text-amass-400">Remediation</h3>
              <p>Engineer Agent — RAG-powered patch generation</p>
            </div>
            <div className="rounded-lg border border-gray-800 p-4">
              <h3 className="mb-2 font-medium text-amass-400">Validation</h3>
              <p>Critic Agent — patch quality assurance</p>
            </div>
            <div className="rounded-lg border border-gray-800 p-4">
              <h3 className="mb-2 font-medium text-amass-400">Orchestration</h3>
              <p>LangGraph — multi-agent workflow</p>
            </div>
            <div className="rounded-lg border border-gray-800 p-4">
              <h3 className="mb-2 font-medium text-amass-400">Knowledge</h3>
              <p>Qdrant — vector embeddings for RAG</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
