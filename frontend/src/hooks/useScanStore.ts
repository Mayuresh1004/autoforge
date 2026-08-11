/**
 * ScanStore Hook — Derives full reactive state from provider events & APIs.
 * Works seamlessly with both Real REST/SSE Provider and Demo Provider.
 * Progressive Disclosure: Findings, targets, exploits, and patches populate
 * dynamically as their respective pipeline events arrive.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { AmassEvent, AmassAgentType, SseConnectionStatus } from '../types/amass-events';
import type {
  ScanModel,
  FindingModel,
  ScoutEndpoint,
  TargetModel,
  ExploitEvidenceModel,
  PatchModel,
  RuntimeSandboxModel,
} from '../types/api-types';
import { getAMASSDataProvider, type DemoTargetId, type DemoScenarioId, type StartScanOptions } from '../providers';

export type AgentStatus = 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface AgentState {
  type: AmassAgentType;
  status: AgentStatus;
  lastMessage?: string;
  updatedAt?: string;
}

export interface CriticStageState {
  name: string;
  key: 'baseline' | 'patch_apply' | 'build' | 'tests' | 'retest' | 'approval';
  status: 'IDLE' | 'RUNNING' | 'PASSED' | 'FAILED';
  message?: string;
}

export interface ScanStoreState {
  activeScanId: string | null;
  scan: ScanModel | null;
  scanStatus: string;
  connectionStatus: SseConnectionStatus;
  events: AmassEvent[];
  lastSequence: number;
  agents: Record<AmassAgentType, AgentState>;
  findings: FindingModel[];
  endpoints: ScoutEndpoint[];
  targets: TargetModel[];
  exploits: ExploitEvidenceModel[];
  patches: PatchModel[];
  sandbox: RuntimeSandboxModel | null;
  criticStages: CriticStageState[];
  activeFindingId: string | null;
  activeFinding: FindingModel | null;
  isLoading: boolean;
  error: string | null;
  isDemoMode: boolean;
}

const INITIAL_AGENTS: Record<AmassAgentType, AgentState> = {
  ANALYZER: { type: 'ANALYZER', status: 'IDLE' },
  SCANNER: { type: 'SCANNER', status: 'IDLE' },
  SANDBOX: { type: 'SANDBOX', status: 'IDLE' },
  SCOUT: { type: 'SCOUT', status: 'IDLE' },
  PLANNER: { type: 'PLANNER', status: 'IDLE' },
  SNIPER: { type: 'SNIPER', status: 'IDLE' },
  ENGINEER: { type: 'ENGINEER', status: 'IDLE' },
  CRITIC: { type: 'CRITIC', status: 'IDLE' },
  BROWSER: { type: 'BROWSER', status: 'IDLE' },
  SYSTEM: { type: 'SYSTEM', status: 'IDLE' },
};

const INITIAL_CRITIC_STAGES: CriticStageState[] = [
  { name: 'Baseline System Check', key: 'baseline', status: 'IDLE' },
  { name: 'Patch Application', key: 'patch_apply', status: 'IDLE' },
  { name: 'Sandbox Build', key: 'build', status: 'IDLE' },
  { name: 'Test Suite Execution', key: 'tests', status: 'IDLE' },
  { name: 'Exploit Retest Verification', key: 'retest', status: 'IDLE' },
  { name: 'Final Security Verdict', key: 'approval', status: 'IDLE' },
];

export function useScanStore(initialScanId: string | null = null) {
  const provider = getAMASSDataProvider();

  const [activeScanId, setActiveScanId] = useState<string | null>(initialScanId);
  const [scan, setScan] = useState<ScanModel | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [events, setEvents] = useState<AmassEvent[]>([]);
  const [lastSequence, setLastSequence] = useState<number>(0);
  const [connectionStatus, setConnectionStatus] = useState<SseConnectionStatus>('CONNECTED');

  const [agents, setAgents] = useState<Record<AmassAgentType, AgentState>>(INITIAL_AGENTS);
  const [findings, setFindings] = useState<FindingModel[]>([]);
  const [endpoints, setEndpoints] = useState<ScoutEndpoint[]>([]);
  const [targets, setTargets] = useState<TargetModel[]>([]);
  const [exploits, setExploits] = useState<ExploitEvidenceModel[]>([]);
  const [patches, setPatches] = useState<PatchModel[]>([]);
  const [sandbox, setSandbox] = useState<RuntimeSandboxModel | null>(null);
  const [criticStages, setCriticStages] = useState<CriticStageState[]>(INITIAL_CRITIC_STAGES);
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);

  const updateCriticStage = useCallback((key: CriticStageState['key'], status: CriticStageState['status'], message?: string) => {
    setCriticStages((prev) =>
      prev.map((s) => (s.key === key ? { ...s, status, message: message ?? s.message } : s))
    );
  }, []);

  // Universal Event Handler (Used by both Real SSE and Demo Provider)
  const handleEvent = useCallback(
    (event: AmassEvent) => {
      // Append event & track monotonic sequence
      setEvents((prev) => {
        if (prev.some((e) => e.eventId === event.eventId || e.sequence === event.sequence)) {
          return prev;
        }
        return [...prev, event];
      });
      setLastSequence(event.sequence);

      // 1. Agent State Updates
      if (event.agentType) {
        setAgents((prev) => {
          const current = prev[event.agentType!];
          let nextStatus: AgentStatus = current?.status ?? 'IDLE';

          if (event.eventType.endsWith('_STARTED') || event.status === 'STARTED' || event.status === 'IN_PROGRESS') {
            nextStatus = 'RUNNING';
          } else if (
            event.eventType.endsWith('_COMPLETED') ||
            event.eventType.endsWith('_CONFIRMED') ||
            event.eventType.endsWith('_APPROVED') ||
            event.eventType.endsWith('_PATCH_GENERATED') ||
            event.status === 'COMPLETED' ||
            event.status === 'SUCCEEDED' ||
            event.status === 'CONFIRMED' ||
            event.status === 'READY'
          ) {
            nextStatus = 'COMPLETED';
          } else if (
            event.eventType.endsWith('_FAILED') ||
            event.eventType.endsWith('_REJECTED') ||
            event.status === 'FAILED' ||
            event.status === 'REJECTED'
          ) {
            nextStatus = 'FAILED';
          }

          return {
            ...prev,
            [event.agentType!]: {
              type: event.agentType!,
              status: nextStatus,
              lastMessage: event.message,
              updatedAt: event.timestamp,
            },
          };
        });
      }

      // 2. Workflow / Scan status update & Clean State Initialization at start
      if (event.eventType === 'SCAN_STARTED') {
        setScan((prev) => (prev ? { ...prev, status: 'RUNNING' } : null));
        setFindings([]);
        setEndpoints([]);
        setTargets([]);
        setExploits([]);
        setPatches([]);
        setSandbox(null);
        setCriticStages(INITIAL_CRITIC_STAGES);
        setActiveFindingId(null);
      } else if (event.eventType === 'SCAN_COMPLETED') {
        setScan((prev) => (prev ? { ...prev, status: 'COMPLETED' } : null));
      } else if (event.eventType === 'SCAN_FAILED') {
        setScan((prev) => (prev ? { ...prev, status: 'FAILED' } : null));
      }

      // 3. Domain Model Progressive Disclosure Handlers
      switch (event.eventType) {
        // SCANNER FINDING DISCOVERED: Append finding progressively & focus it
        case 'SCANNER_FINDING_DISCOVERED': {
          const rawFinding = event.metadata?.finding as FindingModel | undefined;
          if (rawFinding) {
            const newFinding: FindingModel = {
              ...rawFinding,
              findingId: rawFinding.id,
              status: 'DISCOVERED',
              isConfirmed: false,
            };
            setFindings((prev) => {
              if (prev.some((f) => f.id === newFinding.id)) return prev;
              return [...prev, newFinding];
            });
            setActiveFindingId(newFinding.id);
          }
          break;
        }

        // SCANNER COMPLETED: Ensure all findings are present if stream missed any
        case 'SCANNER_COMPLETED':
          provider.getScanResults(event.scanId).then((res) => {
            if (res.success && res.data) {
              const rawFindings = Array.isArray(res.data)
                ? res.data
                : res.data.findings ?? [];
              setFindings((prev) => {
                if (prev.length >= rawFindings.length) return prev;
                return rawFindings.map((f) => ({ ...f, findingId: f.id, status: f.status || 'DISCOVERED', isConfirmed: false }));
              });
            }
          });
          break;

        // PLANNER COMPLETED: Load attack plan targets & update findings status to PLANNED
        case 'PLANNER_COMPLETED':
          provider.getPlanForScan(event.scanId).then((res) => {
            if (res.success && res.data) {
              const planTargets = res.data.targets ?? [];
              setTargets([...planTargets]);
              if (planTargets.length > 0) {
                const targetFindingId = planTargets[0].findingId || planTargets[0].targetId;
                setActiveFindingId(targetFindingId);
              }
              // Mark findings in plan as PLANNED
              setFindings((prev) =>
                prev.map((f) => {
                  if (planTargets.some((t) => t.findingId === f.id || t.targetId === f.id || t.endpoint === f.endpoint)) {
                    return { ...f, status: 'PLANNED' };
                  }
                  return f;
                })
              );
            }
          });
          break;

        // SANDBOX LIFECYCLE
        case 'SANDBOX_PROVISIONING':
          setSandbox((prev) => ({
            sandboxId: (event.metadata?.sandboxId as string) ?? prev?.sandboxId ?? 'sbx_init',
            id: (event.metadata?.sandboxId as string) ?? prev?.id ?? 'sbx_init',
            scanId: event.scanId ?? prev?.scanId ?? 'unknown',
            status: 'PROVISIONING',
            runtime: (event.metadata?.runtime as string) ?? 'docker-isolated',
            repository: prev?.repository ?? {},
            targetUrl: event.metadata?.targetUrl as string | undefined,
            createdAt: event.timestamp,
          }));
          break;

        case 'SANDBOX_READY':
          setSandbox((prev) => ({
            sandboxId: (event.metadata?.sandboxId as string) ?? prev?.sandboxId ?? 'sbx_ready',
            id: (event.metadata?.sandboxId as string) ?? prev?.id ?? 'sbx_ready',
            scanId: event.scanId ?? prev?.scanId ?? 'unknown',
            status: 'READY',
            runtime: (event.metadata?.runtime as string) ?? prev?.runtime ?? 'docker-isolated',
            repository: prev?.repository ?? {},
            targetUrl: (event.metadata?.targetUrl as string) ?? prev?.targetUrl,
            createdAt: prev?.createdAt ?? event.timestamp,
          }));
          break;

        case 'SANDBOX_DESTROYED':
        case 'SANDBOX_FAILED':
          setSandbox((prev) => (prev ? { ...prev, status: event.eventType === 'SANDBOX_FAILED' ? 'FAILED' : 'DESTROYED' } : null));
          break;

        // FINDING-AWARE SCOUT RECON LIFECYCLE
        case 'SCOUT_TARGET_STARTED':
          if (event.metadata?.findingId) {
            const fId = event.metadata.findingId as string;
            setActiveFindingId(fId);
          }
          break;

        case 'SCOUT_ENDPOINT_DISCOVERED': {
          const fId = (event.metadata?.findingId as string) || (event.metadata?.vulnerabilityId as string);
          if (fId) setActiveFindingId(fId);

          const targetEp = (event.metadata?.endpoint || event.metadata?.targetUrl || event.metadata?.url) as string | undefined;
          if (targetEp) {
            setEndpoints((prev) => {
              const exists = prev.some((e) => (e.path || e.url) === targetEp && e.method === (event.metadata?.method ?? 'GET'));
              if (exists) {
                return prev.map((e) => ((e.path || e.url) === targetEp ? { ...e, findingId: fId || e.findingId, status: 'IDENTIFIED' } : e));
              }
              return [
                ...prev,
                {
                  findingId: fId,
                  path: targetEp,
                  url: targetEp,
                  method: (event.metadata?.method as string) ?? 'GET',
                  description: (event.metadata?.description as string) ?? event.message,
                  status: 'IDENTIFIED',
                },
              ];
            });
          }
          break;
        }

        case 'SCOUT_EVIDENCE_COLLECTED': {
          const fId = event.metadata?.findingId as string | undefined;
          if (fId) setActiveFindingId(fId);

          const evText = (event.metadata?.evidence as string) || event.message;
          const epPath = event.metadata?.endpoint as string | undefined;

          setEndpoints((prev) =>
            prev.map((e) => {
              if ((fId && e.findingId === fId) || (epPath && (e.path === epPath || e.url === epPath))) {
                return { ...e, evidence: evText, status: 'EVIDENCE_COLLECTED' };
              }
              return e;
            })
          );
          break;
        }

        case 'SCOUT_TARGET_COMPLETED': {
          const fId = event.metadata?.findingId as string | undefined;
          if (fId) {
            setEndpoints((prev) =>
              prev.map((e) => (e.findingId === fId ? { ...e, status: 'COMPLETED' } : e))
            );
          }
          break;
        }

        // SNIPER TARGET SELECTION & EXPLOIT CONFIRMED
        case 'SNIPER_TARGET_SELECTED':
          if (event.metadata?.findingId || event.metadata?.targetId) {
            const tId = (event.metadata.findingId as string) || (event.metadata.targetId as string);
            setActiveFindingId(tId);
            setTargets((prev) =>
              prev.map((t) => (t.targetId === tId || t.findingId === tId ? { ...t, status: 'IN_PROGRESS' } : t))
            );
            setFindings((prev) =>
              prev.map((f) => (f.id === tId || f.findingId === tId || f.ruleId === tId ? { ...f, status: 'VERIFYING' } : f))
            );
          }
          break;

        case 'SNIPER_CONFIRMED':
          if (event.metadata?.findingId || event.metadata?.vulnerabilityId || event.metadata?.targetId) {
            const targetId = (event.metadata?.findingId as string) || (event.metadata?.targetId as string) || (event.metadata?.vulnerabilityId as string);
            const targetEndpoint = event.metadata?.endpoint as string | undefined;

            setActiveFindingId(targetId);

            // 1. Mark matching finding as EXPLOIT_CONFIRMED
            setFindings((prev) =>
              prev.map((f) => {
                if (
                  f.id === targetId ||
                  f.findingId === targetId ||
                  f.ruleId === targetId ||
                  f.vulnerabilityId === targetId ||
                  (targetEndpoint && f.endpoint === targetEndpoint)
                ) {
                  return { ...f, isConfirmed: true, status: 'EXPLOIT_CONFIRMED' };
                }
                return f;
              })
            );

            // 2. Add exploit evidence
            setExploits((prev) => {
              const exists = prev.some((e) => e.targetId === targetId || e.findingId === targetId);
              if (exists) return prev;
              return [
                ...prev,
                {
                  exploitId: `exp_${targetId}`,
                  targetId,
                  findingId: targetId,
                  scanId: event.scanId,
                  confirmed: true,
                  endpoint: targetEndpoint,
                  method: (event.metadata?.method as string) ?? 'GET',
                  verificationNotes: event.message,
                },
              ];
            });
          }
          break;

        // ENGINEER REMEDIATION
        case 'ENGINEER_STARTED':
          setFindings((prev) =>
            prev.map((f) => (f.isConfirmed ? { ...f, status: 'REMEDIATION' } : f))
          );
          break;

        case 'ENGINEER_PATCH_GENERATED':
          if (event.metadata?.patchId || event.metadata?.filePath) {
            const patchFindingId = event.metadata?.findingId as string | undefined;
            setPatches((prev) => {
              const patchId = (event.metadata?.patchId as string) ?? `patch_${Date.now()}`;
              const exists = prev.some((p) => p.patchId === patchId);
              if (exists) return prev;
              return [
                ...prev,
                {
                  patchId,
                  findingId: patchFindingId,
                  scanId: event.scanId,
                  filePath: (event.metadata?.filePath as string) ?? 'src/vulnerable.ts',
                  diffContent: event.message,
                  status: 'GENERATED',
                },
              ];
            });
            setFindings((prev) =>
              prev.map((f) => (f.isConfirmed ? { ...f, status: 'PATCHED' } : f))
            );
          }
          break;

        // Critic Stage Machine & Final Verdict
        case 'BASELINE_CHECK_STARTED':
          updateCriticStage('baseline', 'RUNNING', event.message);
          break;
        case 'BASELINE_CHECK_COMPLETED':
          updateCriticStage('baseline', 'PASSED', event.message);
          break;

        case 'PATCH_APPLY_STARTED':
          updateCriticStage('patch_apply', 'RUNNING', event.message);
          break;
        case 'PATCH_APPLIED':
          updateCriticStage('patch_apply', 'PASSED', event.message);
          break;

        case 'BUILD_STARTED':
          updateCriticStage('build', 'RUNNING', event.message);
          break;
        case 'BUILD_COMPLETED':
          updateCriticStage('build', 'PASSED', event.message);
          break;

        case 'TESTS_STARTED':
          updateCriticStage('tests', 'RUNNING', event.message);
          break;
        case 'TESTS_COMPLETED':
          updateCriticStage('tests', 'PASSED', event.message);
          break;

        case 'EXPLOIT_RETEST_STARTED':
          updateCriticStage('retest', 'RUNNING', event.message);
          break;
        case 'EXPLOIT_RETEST_COMPLETED':
          updateCriticStage('retest', 'PASSED', event.message);
          break;

        case 'CRITIC_APPROVED':
          updateCriticStage('approval', 'PASSED', event.message);
          setFindings((prev) =>
            prev.map((f) => (f.isConfirmed ? { ...f, status: 'CRITIC_VERIFIED' } : f))
          );
          break;

        case 'CRITIC_REJECTED':
        case 'CRITIC_FAILED':
          updateCriticStage('approval', 'FAILED', event.message);
          break;
      }
    },
    [provider, updateCriticStage]
  );

  // Fetch initial REST state when active scan changes
  const fetchScanData = useCallback(
    async (scanId: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const scanRes = await provider.getScan(scanId);

        if (scanRes.success && scanRes.data) {
          setScan(scanRes.data);

          // If scan is ALREADY COMPLETED (historical view), fetch final findings and plan immediately
          if (scanRes.data.status === 'COMPLETED') {
            const [resultsRes, planRes] = await Promise.all([
              provider.getScanResults(scanId),
              provider.getPlanForScan(scanId),
            ]);

            if (resultsRes.success && resultsRes.data) {
              const rawFindings = Array.isArray(resultsRes.data)
                ? resultsRes.data
                : resultsRes.data.findings ?? [];
              setFindings(rawFindings);
              if (rawFindings.length > 0) {
                setActiveFindingId(rawFindings[0].id);
              }
            }

            if (planRes.success && planRes.data) {
              setTargets([...(planRes.data.targets ?? [])]);
            }
          }
        } else {
          setError(scanRes.error?.message ?? 'Scan not found');
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load scan details');
      } finally {
        setIsLoading(false);
      }
    },
    [provider]
  );

  // Subscribe to events when active scan is selected
  useEffect(() => {
    if (!activeScanId) return;

    setAgents(INITIAL_AGENTS);
    setCriticStages(INITIAL_CRITIC_STAGES);
    setEvents([]);
    setLastSequence(0);
    setConnectionStatus('CONNECTED');
    setFindings([]);
    setEndpoints([]);
    setTargets([]);
    setExploits([]);
    setPatches([]);
    setSandbox(null);
    setActiveFindingId(null);

    fetchScanData(activeScanId);

    const unsubscribe = provider.subscribeEvents(activeScanId, handleEvent);

    return () => {
      unsubscribe();
    };
  }, [activeScanId, fetchScanData, handleEvent, provider]);

  const selectScan = useCallback((scanId: string) => {
    setActiveScanId(scanId);
  }, []);

  const startScan = useCallback(
    async (options: StartScanOptions) => {
      const res = await provider.startScan(options);
      if (res.success && res.data) {
        const newScanId = res.data.scanId || res.data.id;
        if (newScanId) setActiveScanId(newScanId);
      }
      return res;
    },
    [provider]
  );

  const startDemoScan = useCallback(
    async (targetId: DemoTargetId, scenarioId: DemoScenarioId, speedMultiplier: number = 1.0) => {
      if ('setDemoConfig' in provider && typeof (provider as any).setDemoConfig === 'function') {
        (provider as any).setDemoConfig(targetId, scenarioId, speedMultiplier);
      }
      const res = await provider.startScan({ demoTargetId: targetId, scenarioId, speedMultiplier });
      if (res.success && res.data) {
        const newScanId = res.data.scanId;
        setActiveScanId(newScanId);
      }
    },
    [provider]
  );

  const resetDemoScan = useCallback(() => {
    if ('stopActiveDemoScan' in provider && typeof (provider as any).stopActiveDemoScan === 'function') {
      (provider as any).stopActiveDemoScan();
    }
    if (activeScanId) {
      setAgents(INITIAL_AGENTS);
      setCriticStages(INITIAL_CRITIC_STAGES);
      setEvents([]);
      setLastSequence(0);
      setFindings([]);
      setEndpoints([]);
      setTargets([]);
      setExploits([]);
      setPatches([]);
      setSandbox(null);
      setActiveFindingId(null);
      fetchScanData(activeScanId);
    }
  }, [activeScanId, fetchScanData, provider]);

  const activeFinding = useMemo(() => {
    if (!activeFindingId) return findings[0] ?? null;
    return findings.find((f) => f.id === activeFindingId || f.findingId === activeFindingId) ?? findings[0] ?? null;
  }, [activeFindingId, findings]);

  const value = useMemo(
    () => ({
      activeScanId,
      scan,
      scanStatus: scan?.status ?? 'UNKNOWN',
      connectionStatus,
      events,
      lastSequence,
      agents,
      findings,
      endpoints,
      targets,
      exploits,
      patches,
      sandbox,
      criticStages,
      activeFindingId,
      activeFinding,
      isLoading,
      error,
      isDemoMode: provider.isDemoMode,
      selectScan,
      startScan,
      startDemoScan,
      resetDemoScan,
      refresh: () => (activeScanId ? fetchScanData(activeScanId) : undefined),
    }),
    [
      activeScanId,
      scan,
      connectionStatus,
      events,
      lastSequence,
      agents,
      findings,
      endpoints,
      targets,
      exploits,
      patches,
      sandbox,
      criticStages,
      activeFindingId,
      activeFinding,
      isLoading,
      error,
      provider.isDemoMode,
      selectScan,
      startScan,
      startDemoScan,
      resetDemoScan,
      fetchScanData,
    ]
  );

  return value;
}
