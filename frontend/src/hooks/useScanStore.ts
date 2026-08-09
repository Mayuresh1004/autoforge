/**
 * ScanStore Hook — Derives full reactive state from authoritative Phase 9 SSE Events & REST APIs.
 * NO FAKE PROGRESS OR TIMERS.
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
import { useSseStream } from './useSseStream';
import { api } from '../api/client';

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
  isLoading: boolean;
  error: string | null;
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
  const [activeScanId, setActiveScanId] = useState<string | null>(initialScanId);
  const [scan, setScan] = useState<ScanModel | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [agents, setAgents] = useState<Record<AmassAgentType, AgentState>>(INITIAL_AGENTS);
  const [findings, setFindings] = useState<FindingModel[]>([]);
  const [endpoints, setEndpoints] = useState<ScoutEndpoint[]>([]);
  const [targets, setTargets] = useState<TargetModel[]>([]);
  const [exploits, setExploits] = useState<ExploitEvidenceModel[]>([]);
  const [patches, setPatches] = useState<PatchModel[]>([]);
  const [sandbox, setSandbox] = useState<RuntimeSandboxModel | null>(null);
  const [criticStages, setCriticStages] = useState<CriticStageState[]>(INITIAL_CRITIC_STAGES);

  // SSE event stream callback
  const handleEvent = useCallback((event: AmassEvent) => {
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

    // 2. Specific Event Type Handlers
    switch (event.eventType) {
      case 'SANDBOX_PROVISIONING':
        setSandbox((prev) => ({
          sandboxId: event.metadata?.sandboxId ?? prev?.sandboxId ?? 'sbx_init',
          id: event.metadata?.sandboxId ?? prev?.id ?? 'sbx_init',
          scanId: event.scanId ?? prev?.scanId ?? 'unknown',
          status: 'PROVISIONING',
          runtime: (event.metadata?.runtime as string) ?? 'docker',
          repository: prev?.repository ?? {},
          targetUrl: event.metadata?.targetUrl,
          createdAt: event.timestamp,
        }));
        break;

      case 'SANDBOX_READY':
        setSandbox((prev) => ({
          sandboxId: event.metadata?.sandboxId ?? prev?.sandboxId ?? 'sbx_ready',
          id: event.metadata?.sandboxId ?? prev?.id ?? 'sbx_ready',
          scanId: event.scanId ?? prev?.scanId ?? 'unknown',
          status: 'READY',
          runtime: (event.metadata?.runtime as string) ?? prev?.runtime ?? 'docker',
          repository: prev?.repository ?? {},
          targetUrl: event.metadata?.targetUrl ?? prev?.targetUrl,
          createdAt: prev?.createdAt ?? event.timestamp,
        }));
        break;

      case 'SANDBOX_DESTROYED':
      case 'SANDBOX_FAILED':
        setSandbox((prev) => (prev ? { ...prev, status: event.eventType === 'SANDBOX_FAILED' ? 'FAILED' : 'DESTROYED' } : null));
        break;

      case 'SCOUT_ENDPOINT_DISCOVERED': {
        const targetEp = (event.metadata?.endpoint || event.metadata?.targetUrl || event.metadata?.url) as string | undefined;
        if (targetEp) {
          setEndpoints((prev) => {
            const exists = prev.some((e) => (e.path || e.url) === targetEp && e.method === (event.metadata?.method ?? 'GET'));
            if (exists) return prev;
            return [
              ...prev,
              {
                path: targetEp,
                url: targetEp,
                method: (event.metadata?.method as string) ?? 'GET',
                description: event.message,
              },
            ];
          });
        }
        break;
      }

      case 'SNIPER_CONFIRMED':
        if (event.metadata?.vulnerabilityId || event.metadata?.targetId) {
          setExploits((prev) => {
            const id = (event.metadata?.targetId as string) || (event.metadata?.vulnerabilityId as string) || `exp_${Date.now()}`;
            const exists = prev.some((e) => e.exploitId === id);
            if (exists) return prev;
            return [
              ...prev,
              {
                exploitId: id,
                targetId: (event.metadata?.targetId as string) ?? id,
                scanId: event.scanId,
                confirmed: true,
                endpoint: event.metadata?.endpoint as string | undefined,
                method: (event.metadata?.method as string) ?? 'GET',
                verificationNotes: event.message,
              },
            ];
          });
        }
        break;

      case 'ENGINEER_PATCH_GENERATED':
        if (event.metadata?.patchId || event.metadata?.filePath) {
          setPatches((prev) => [
            ...prev,
            {
              patchId: (event.metadata?.patchId as string) ?? `patch_${Date.now()}`,
              scanId: event.scanId,
              filePath: (event.metadata?.filePath as string) ?? 'src/vulnerable.ts',
              diffContent: event.message,
              status: 'GENERATED',
            },
          ]);
        }
        break;

      // Critic Stage Machine
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
        break;
      case 'CRITIC_REJECTED':
      case 'CRITIC_FAILED':
        updateCriticStage('approval', 'FAILED', event.message);
        break;
    }
  }, []);

  const updateCriticStage = (key: CriticStageState['key'], status: CriticStageState['status'], message?: string) => {
    setCriticStages((prev) =>
      prev.map((s) => (s.key === key ? { ...s, status, message: message ?? s.message } : s))
    );
  };

  // SSE Stream
  const sse = useSseStream({
    scanId: activeScanId,
    onEvent: handleEvent,
    enabled: Boolean(activeScanId),
  });

  // Fetch initial REST state when active scan changes
  const fetchScanData = useCallback(async (scanId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const [scanRes, resultsRes] = await Promise.all([
        api.getScan(scanId),
        api.getScanResults(scanId),
        api.getScanStatistics(scanId),
      ]);

      if (scanRes.success && scanRes.data) {
        setScan(scanRes.data);
      } else {
        setError(scanRes.error?.message ?? 'Scan not found');
      }

      if (resultsRes.success && resultsRes.data) {
        const rawFindings = Array.isArray(resultsRes.data)
          ? resultsRes.data
          : resultsRes.data.findings ?? [];
        setFindings(rawFindings);
      }

      // Try fetching plan for targets
      const planRes = await api.getPlanForScan(scanId);
      if (planRes.success && planRes.data) {
        setTargets([...(planRes.data.targets ?? [])]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load scan details');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeScanId) {
      setAgents(INITIAL_AGENTS);
      setCriticStages(INITIAL_CRITIC_STAGES);
      setFindings([]);
      setEndpoints([]);
      setTargets([]);
      setExploits([]);
      setPatches([]);
      setSandbox(null);
      fetchScanData(activeScanId);
    }
  }, [activeScanId, fetchScanData]);

  const selectScan = useCallback((scanId: string) => {
    setActiveScanId(scanId);
  }, []);

  const value: ScanStoreState & { selectScan: (id: string) => void; refresh: () => void } = useMemo(
    () => ({
      activeScanId,
      scan,
      scanStatus: scan?.status ?? 'UNKNOWN',
      connectionStatus: sse.status,
      events: sse.events,
      lastSequence: sse.lastSequence,
      agents,
      findings,
      endpoints,
      targets,
      exploits,
      patches,
      sandbox,
      criticStages,
      isLoading,
      error,
      selectScan,
      refresh: () => (activeScanId ? fetchScanData(activeScanId) : undefined),
    }),
    [
      activeScanId,
      scan,
      sse.status,
      sse.events,
      sse.lastSequence,
      agents,
      findings,
      endpoints,
      targets,
      exploits,
      patches,
      sandbox,
      criticStages,
      isLoading,
      error,
      selectScan,
      fetchScanData,
    ]
  );

  return value;
}
