import { useState } from 'react';
import { Header } from './components/shell/Header';
import { AgentPipeline } from './components/pipeline/AgentPipeline';
import { EventTimeline } from './components/timeline/EventTimeline';
import { SandboxViewport } from './components/sandbox/SandboxViewport';
import { FindingsList } from './components/findings/FindingsList';
import { ExploitPanel } from './components/evidence/ExploitPanel';
import { PatchView } from './components/remediation/PatchView';
import { ValidationMatrix } from './components/critic/ValidationMatrix';
import { Tabs, type TabItem } from './components/ui/Tabs';
import { Button } from './components/ui/Button';
import { useScanStore } from './hooks/useScanStore';
import type { FindingModel } from './types/api-types';

export default function App() {
  const store = useScanStore(null);
  const [activeCenterTab, setActiveCenterTab] = useState<string>('sandbox');
  const [selectedFinding, setSelectedFinding] = useState<FindingModel | null>(null);

  const centerTabs: TabItem[] = [
    { id: 'sandbox', label: '1. Live Sandbox & Recon', count: store.endpoints.length },
    { id: 'exploitation', label: '2. Exploitation Evidence', count: store.exploits.length },
    { id: 'patch', label: '3. Remediation Patch', count: store.patches.length },
    { id: 'critic', label: '4. Critic QA Matrix', count: store.criticStages.filter((s) => s.status === 'PASSED').length },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans antialiased selection:bg-sky-500/30 selection:text-sky-200">
      {/* Shell Header */}
      <Header
        activeScanId={store.activeScanId}
        scanStatus={store.scanStatus}
        connectionStatus={store.connectionStatus}
        onSelectScan={store.selectScan}
        onScanCreated={(newScan) => store.selectScan(newScan.id)}
      />

      {/* Agent Pipeline Bar */}
      <AgentPipeline agents={store.agents} />

      {/* Error / Loading Banner if applicable */}
      {store.error && (
        <div className="mx-6 mt-4 flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-400">
          <span>⚠️ {store.error}</span>
          <Button variant="ghost" size="sm" onClick={store.refresh}>
            Retry
          </Button>
        </div>
      )}

      {/* Primary 3-Pane Workbench Workspace */}
      <main className="flex-1 p-4 md:p-6 grid grid-cols-1 gap-4 lg:grid-cols-12 max-w-[1920px] mx-auto w-full">
        {/* Left Pane: Vulnerability Findings & Targets (3 Cols) */}
        <section className="lg:col-span-3 flex flex-col h-[calc(100vh-140px)] min-h-[500px]">
          <FindingsList
            findings={store.findings}
            onSelectFinding={(finding) => {
              setSelectedFinding(finding);
              if (finding.isConfirmed) {
                setActiveCenterTab('exploitation');
              }
            }}
          />
        </section>

        {/* Center Pane: Active Stage Inspector Workspace (5 Cols) */}
        <section className="lg:col-span-5 flex flex-col h-[calc(100vh-140px)] min-h-[500px] border border-zinc-800 bg-zinc-950/60 rounded-xl overflow-hidden shadow-sm">
          <Tabs tabs={centerTabs} activeTab={activeCenterTab} onChange={setActiveCenterTab} />

          <div className="flex-1 overflow-y-auto p-4">
            {activeCenterTab === 'sandbox' && (
              <SandboxViewport sandbox={store.sandbox} endpoints={store.endpoints} />
            )}

            {activeCenterTab === 'exploitation' && (
              <div className="space-y-4">
                {selectedFinding && (
                  <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-300">
                    <span className="font-semibold block mb-0.5">Focus Finding: {selectedFinding.title}</span>
                    <span className="font-mono text-[11px] opacity-80">{selectedFinding.filePath}:{selectedFinding.lineStart}</span>
                  </div>
                )}
                <ExploitPanel exploits={store.exploits} />
              </div>
            )}

            {activeCenterTab === 'patch' && (
              <PatchView patches={store.patches} />
            )}

            {activeCenterTab === 'critic' && (
              <ValidationMatrix stages={store.criticStages} />
            )}
          </div>
        </section>

        {/* Right Pane: Real-Time SSE Event Stream Log Terminal (4 Cols) */}
        <section className="lg:col-span-4 flex flex-col h-[calc(100vh-140px)] min-h-[500px]">
          <EventTimeline events={store.events} lastSequence={store.lastSequence} connectionStatus={store.connectionStatus} />
        </section>
      </main>
    </div>
  );
}
