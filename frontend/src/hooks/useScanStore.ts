/**
 * ScanStore Hook — Single Normalized Event-Driven Reducer Architecture.
 * Works seamlessly with both Real REST/SSE Provider and Demo Provider.
 * 
 * Single Source of Truth: `findingsById` maps each discovered vulnerability
 * to its finding model, scout endpoint, target plan, exploit evidence, patch,
 * and Critic QA stage checklist.
 * 
 * All UI collections (findings, targets, endpoints, exploits, patches, criticMatrix)
 * are pure derived selectors from `findingsById`.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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

export interface FindingRecord {
  finding: FindingModel;
  endpoint?: ScoutEndpoint;
  target?: TargetModel;
  exploit?: ExploitEvidenceModel;
  patch?: PatchModel;
  criticStages: CriticStageState[];
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
  criticMatrix: Record<string, CriticStageState[]>;
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

export function createInitialCriticStages(): CriticStageState[] {
  return INITIAL_CRITIC_STAGES.map((s) => ({ ...s }));
}

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
  const [sandbox, setSandbox] = useState<RuntimeSandboxModel | null>(null);

  // SINGLE NORMALIZED REDUCER STATE CONTAINER
  const [findingsById, setFindingsById] = useState<Record<string, FindingRecord>>({});
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);

  // PURE DERIVED SELECTORS FROM `findingsById`
  const findings = useMemo(() => {
    return Object.values(findingsById).map((record) => ({
      ...record.finding,
      status: record.finding.status,
    }));
  }, [findingsById]);

  const targets = useMemo(() => {
    return Object.values(findingsById)
      .map((record) => record.target)
      .filter((t): t is TargetModel => Boolean(t));
  }, [findingsById]);

  const endpoints = useMemo(() => {
    return Object.values(findingsById)
      .map((record) => record.endpoint)
      .filter((e): e is ScoutEndpoint => Boolean(e));
  }, [findingsById]);

  const exploits = useMemo(() => {
    return Object.values(findingsById)
      .map((record) => record.exploit)
      .filter((e): e is ExploitEvidenceModel => Boolean(e));
  }, [findingsById]);

  const patches = useMemo(() => {
    return Object.values(findingsById)
      .map((record) => record.patch)
      .filter((p): p is PatchModel => Boolean(p));
  }, [findingsById]);

  const criticMatrix = useMemo(() => {
    const map: Record<string, CriticStageState[]> = {};
    Object.values(findingsById).forEach((record) => {
      map[record.finding.id] = record.criticStages;
    });
    return map;
  }, [findingsById]);

  // Universal Event Handler — Single Reducer Authority
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

      // 1. Agent Pipeline Stage Statuses (Strictly driven by explicit phase events)
      if (event.agentType) {
        setAgents((prev) => {
          const current = prev[event.agentType!];
          let nextStatus: AgentStatus = current?.status ?? 'IDLE';

          if (event.eventType.endsWith('_STARTED') || event.status === 'STARTED') {
            nextStatus = 'RUNNING';
          } else if (
            event.eventType === 'ANALYZER_COMPLETED' ||
            event.eventType === 'SCANNER_COMPLETED' ||
            (event.agentType === 'SANDBOX' && (event.eventType === 'SANDBOX_READY' || event.status === 'READY')) ||
            event.eventType === 'SCOUT_COMPLETED' ||
            (event.eventType === 'PLANNER_COMPLETED' && event.status === 'COMPLETED') ||
            event.eventType === 'SNIPER_VERIFICATION_COMPLETED' ||
            event.eventType === 'ENGINEER_COMPLETED' ||
            event.eventType === 'CRITIC_COMPLETED' ||
            (event.agentType === 'SYSTEM' && event.eventType === 'SCAN_COMPLETED')
          ) {
            nextStatus = 'COMPLETED';
          } else if (
            event.eventType.endsWith('_FAILED') ||
            event.status === 'FAILED'
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
        setFindingsById({});
        setSandbox(null);
        setActiveFindingId(null);
      } else if (event.eventType === 'SCAN_COMPLETED') {
        setScan((prev) => (prev ? { ...prev, status: 'COMPLETED' } : null));
      } else if (event.eventType === 'SCAN_FAILED') {
        setScan((prev) => (prev ? { ...prev, status: 'FAILED' } : null));
      }

      // 3. Domain Model State Reducer (Strictly findingId-keyed updates)
      const targetFindingId = (event.metadata?.findingId as string) || (event.metadata?.vulnerabilityId as string) || (event.metadata?.targetId as string);

      switch (event.eventType) {
        // SCANNER FINDING DISCOVERED: Register finding in findingsById
        case 'SCANNER_FINDING_DISCOVERED': {
          const rawFinding = event.metadata?.finding as FindingModel | undefined;
          const fId = targetFindingId || rawFinding?.id;
          if (fId && rawFinding) {
            const newFinding: FindingModel = {
              ...rawFinding,
              id: fId,
              findingId: fId,
              status: 'DISCOVERED',
              isConfirmed: false,
            };
            setFindingsById((prev) => {
              if (prev[fId]) return prev;
              return {
                ...prev,
                [fId]: {
                  finding: newFinding,
                  criticStages: createInitialCriticStages(),
                },
              };
            });
            // Keep active selection stable on first finding
            setActiveFindingId((prev) => prev ?? fId);
          }
          break;
        }

        case 'SCANNER_COMPLETED': {
          // Trigger REST hydration to pull newly persisted static findings
          if (event.scanId) {
            fetchScanDataRef.current(event.scanId);
          }
          break;
        }

        // SCOUT RECON ENDPOINT DISCOVERED
        case 'SCOUT_ENDPOINT_DISCOVERED': {
          const epPath = (event.metadata?.endpoint || event.metadata?.targetUrl || event.metadata?.url) as string | undefined;
          if (epPath) {
            const method = (event.metadata?.method as string) ?? 'GET';
            const desc = (event.metadata?.description as string) ?? event.message;
            setFindingsById((prev) => {
              const keys = Object.keys(prev);
              const fId = targetFindingId && prev[targetFindingId]
                ? targetFindingId
                : keys.find((k) => !prev[k].endpoint) || keys[0];

              if (!fId || !prev[fId]) return prev;

              const newEndpoint: ScoutEndpoint = {
                findingId: fId,
                path: epPath,
                url: epPath,
                method,
                description: desc,
                status: 'IDENTIFIED',
              };
              return {
                ...prev,
                [fId]: {
                  ...prev[fId],
                  endpoint: newEndpoint,
                },
              };
            });
          }
          break;
        }

        case 'SCOUT_EVIDENCE_COLLECTED': {
          const evText = (event.metadata?.evidence as string) || event.message;
          if (targetFindingId) {
            setFindingsById((prev) => {
              const record = prev[targetFindingId];
              if (!record || !record.endpoint) return prev;
              return {
                ...prev,
                [targetFindingId]: {
                  ...record,
                  endpoint: { ...record.endpoint, evidence: evText, status: 'EVIDENCE_COLLECTED' },
                },
              };
            });
          }
          break;
        }

        case 'SCOUT_TARGET_COMPLETED': {
          if (targetFindingId) {
            setFindingsById((prev) => {
              const record = prev[targetFindingId];
              if (!record || !record.endpoint) return prev;
              return {
                ...prev,
                [targetFindingId]: {
                  ...record,
                  endpoint: { ...record.endpoint, status: 'COMPLETED' },
                },
              };
            });
          }
          break;
        }

        // PLANNER TARGET PLANNED: Attach target model & update finding status
        case 'PLANNER_COMPLETED': {
          const targetMeta = event.metadata?.target as TargetModel | undefined;
          const fId = targetFindingId || targetMeta?.findingId || targetMeta?.targetId;
          if (fId && targetMeta) {
            setFindingsById((prev) => {
              const record = prev[fId];
              if (!record) return prev;
              return {
                ...prev,
                [fId]: {
                  ...record,
                  target: targetMeta,
                  finding: {
                    ...record.finding,
                    status: record.finding.status === 'DISCOVERED' ? 'PLANNED' : record.finding.status,
                  },
                },
              };
            });
          } else if (event.scanId) {
            // Trigger REST hydration to pull newly saved attack plan targets
            fetchScanDataRef.current(event.scanId);
          }
          break;
        }

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

        // SNIPER EXPLOIT VERIFICATION
        case 'SNIPER_TARGET_SELECTED':
          if (targetFindingId) {
            setFindingsById((prev) => {
              const key = Object.keys(prev).find(
                (k) => k === targetFindingId || prev[k].target?.targetId === targetFindingId || prev[k].finding.id === targetFindingId
              );
              if (!key || !prev[key]) return prev;
              return {
                ...prev,
                [key]: {
                  ...prev[key],
                  finding: { ...prev[key].finding, status: 'VERIFYING' },
                },
              };
            });
          }
          break;

        case 'SNIPER_CONFIRMED':
          if (targetFindingId) {
            const expMeta = (event.metadata?.exploit as ExploitEvidenceModel | undefined) ?? {
              exploitId: `exp_${targetFindingId}`,
              targetId: targetFindingId,
              findingId: targetFindingId,
              scanId: event.scanId,
              confirmed: true,
              endpoint: event.metadata?.endpoint as string | undefined,
              method: (event.metadata?.method as string) ?? 'GET',
              verificationNotes: event.message,
            };
            setFindingsById((prev) => {
              const key = Object.keys(prev).find(
                (k) => k === targetFindingId || prev[k].target?.targetId === targetFindingId || prev[k].finding.id === targetFindingId
              ) || targetFindingId;
              const record = prev[key];
              if (!record) return prev;
              return {
                ...prev,
                [key]: {
                  ...record,
                  exploit: expMeta,
                  finding: { ...record.finding, status: 'EXPLOIT_CONFIRMED', isConfirmed: true },
                },
              };
            });
          }
        case 'SNIPER_REJECTED':
          if (targetFindingId) {
            const isNotTested =
              event.metadata?.result === 'NOT_TESTED' ||
              (event.metadata?.reason as string)?.includes('unsupported') ||
              (event.metadata?.reason as string)?.includes('refused') ||
              (event.metadata?.reason as string)?.includes('auth');
            const statusLabel = isNotTested ? 'NOT_TESTED' : 'EXPLOIT_REJECTED';

            setFindingsById((prev) => {
              const key =
                Object.keys(prev).find(
                  (k) =>
                    k === targetFindingId ||
                    prev[k].target?.targetId === targetFindingId ||
                    prev[k].finding.id === targetFindingId
                ) || targetFindingId;
              const record = prev[key];
              if (!record) return prev;
              return {
                ...prev,
                [key]: {
                  ...record,
                  finding: { ...record.finding, status: statusLabel },
                },
              };
            });
          }
          break;

        // ENGINEER REMEDIATION PATCH
        case 'ENGINEER_PATCH_GENERATED':
          if (targetFindingId) {
            const patchMeta = (event.metadata?.patch as PatchModel | undefined) ?? {
              patchId: (event.metadata?.patchId as string) ?? `patch_${targetFindingId}`,
              findingId: targetFindingId,
              scanId: event.scanId,
              filePath: (event.metadata?.filePath as string) ?? 'src/vulnerable.ts',
              diffContent: event.message,
              status: 'GENERATED',
              explanation: (event.metadata?.explanation as string) ?? 'Automated defensive code patch.',
            };
            setFindingsById((prev) => {
              const key = Object.keys(prev).find(
                (k) => k === targetFindingId || prev[k].finding.id === targetFindingId || prev[k].target?.targetId === targetFindingId
              ) || targetFindingId;
              const record = prev[key];
              if (!record) return prev;
              return {
                ...prev,
                [key]: {
                  ...record,
                  patch: patchMeta,
                  finding: { ...record.finding, status: 'PATCHED' },
                },
              };
            });
          }
          break;

        // CRITIC QA STAGE MACHINE
        case 'BASELINE_CHECK_STARTED':
        case 'BASELINE_CHECK_COMPLETED':
        case 'PATCH_APPLY_STARTED':
        case 'PATCH_APPLIED':
        case 'BUILD_STARTED':
        case 'BUILD_COMPLETED':
        case 'TESTS_STARTED':
        case 'TESTS_COMPLETED':
        case 'EXPLOIT_RETEST_STARTED':
        case 'EXPLOIT_RETEST_COMPLETED': {
          if (targetFindingId) {
            const keyMap: Record<string, CriticStageState['key']> = {
              BASELINE_CHECK_STARTED: 'baseline',
              BASELINE_CHECK_COMPLETED: 'baseline',
              PATCH_APPLY_STARTED: 'patch_apply',
              PATCH_APPLIED: 'patch_apply',
              BUILD_STARTED: 'build',
              BUILD_COMPLETED: 'build',
              TESTS_STARTED: 'tests',
              TESTS_COMPLETED: 'tests',
              EXPLOIT_RETEST_STARTED: 'retest',
              EXPLOIT_RETEST_COMPLETED: 'retest',
            };
            const stageKey = keyMap[event.eventType];
            const stageStatus: CriticStageState['status'] = event.eventType.endsWith('_STARTED')
              ? 'RUNNING'
              : event.eventType.endsWith('_COMPLETED') || event.eventType === 'PATCH_APPLIED'
                ? 'PASSED'
                : 'IDLE';

            setFindingsById((prev) => {
              const key = Object.keys(prev).find(
                (k) => k === targetFindingId || prev[k].finding.id === targetFindingId || prev[k].target?.targetId === targetFindingId
              ) || targetFindingId;
              const record = prev[key];
              if (!record) return prev;
              const nextStages = record.criticStages.map((s) =>
                s.key === stageKey ? { ...s, status: stageStatus, message: event.message } : s
              );
              return {
                ...prev,
                [key]: {
                  ...record,
                  criticStages: nextStages,
                },
              };
            });
          }
          break;
        }

        case 'CRITIC_APPROVED':
          if (targetFindingId) {
            setFindingsById((prev) => {
              const key = Object.keys(prev).find(
                (k) => k === targetFindingId || prev[k].finding.id === targetFindingId || prev[k].target?.targetId === targetFindingId
              ) || targetFindingId;
              const record = prev[key];
              if (!record) return prev;
              const nextStages = record.criticStages.map((s) =>
                s.key === 'approval' ? { ...s, status: 'PASSED' as const, message: event.message } : s
              );
              return {
                ...prev,
                [key]: {
                  ...record,
                  criticStages: nextStages,
                  finding: { ...record.finding, status: 'CRITIC_VERIFIED' },
                },
              };
            });
          }
          break;

        case 'CRITIC_REJECTED':
        case 'CRITIC_FAILED':
          if (targetFindingId) {
            setFindingsById((prev) => {
              const key = Object.keys(prev).find(
                (k) => k === targetFindingId || prev[k].finding.id === targetFindingId || prev[k].target?.targetId === targetFindingId
              ) || targetFindingId;
              const record = prev[key];
              if (!record) return prev;
              const nextStages = record.criticStages.map((s) =>
                s.key === 'approval' ? { ...s, status: 'FAILED' as const, message: event.message } : s
              );
              return {
                ...prev,
                [key]: {
                  ...record,
                  criticStages: nextStages,
                  finding: { ...record.finding, status: 'EXPLOIT_REJECTED' },
                },
              };
            });
          }
          break;
      }
    },
    [provider]
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
        }

        const [resultsRes, planRes] = await Promise.all([
          provider.getScanResults(scanId).catch(() => null),
          provider.getPlanForScan(scanId).catch(() => null),
        ]);

        const rawFindings =
          resultsRes && resultsRes.success && resultsRes.data
            ? Array.isArray(resultsRes.data)
              ? resultsRes.data
              : resultsRes.data.findings ?? []
            : [];

        const planTargets =
          planRes && planRes.success && planRes.data ? planRes.data.targets ?? [] : [];

        if (rawFindings.length > 0 || planTargets.length > 0) {
          setFindingsById((prev) => {
            const map: Record<string, FindingRecord> = { ...prev };

            rawFindings.forEach((f) => {
              const fId = f.id || f.findingId || '';
              if (!fId) return;
              if (!map[fId]) {
                map[fId] = {
                  finding: {
                    ...f,
                    id: fId,
                    findingId: fId,
                    status: f.status ?? 'DISCOVERED',
                  },
                  criticStages: createInitialCriticStages(),
                };
              } else {
                map[fId] = {
                  ...map[fId],
                  finding: {
                    ...f,
                    ...map[fId].finding,
                    id: fId,
                    findingId: fId,
                  },
                };
              }
            });

            planTargets.forEach((target) => {
              const tFindingId = (target as any).findingId || (target as any).vulnerabilityId;
              let targetKey: string | undefined;

              if (tFindingId && map[tFindingId]) {
                targetKey = tFindingId;
              } else {
                const candidateList = target.candidateVulnerabilities ?? [];
                const matchedKey = Object.keys(map).find((key) => {
                  const f = map[key].finding;
                  if (map[key].target) return false;
                  return (
                    (f.vulnType && candidateList.some((c) => c.toLowerCase().includes(f.vulnType!.toLowerCase()))) ||
                    (f.title && candidateList.some((c) => c.toLowerCase().includes(f.title!.toLowerCase()))) ||
                    (f.cwe && candidateList.some((c) => c.includes(f.cwe!)))
                  );
                });

                if (matchedKey) {
                  targetKey = matchedKey;
                } else {
                  const unassignedKey = Object.keys(map).find((k) => !map[k].target);
                  if (unassignedKey) {
                    targetKey = unassignedKey;
                  } else {
                    targetKey = target.targetId;
                  }
                }
              }

              if (targetKey) {
                if (!map[targetKey]) {
                  const syntheticFinding: FindingModel = {
                    id: targetKey,
                    findingId: targetKey,
                    title: `Planned Target: ${target.endpoint}`,
                    description: target.reason || `Target priority ${target.priorityScore ?? target.priority}`,
                    severity: (target.estimatedRisk as any) || 'HIGH',
                    status: 'PLANNED',
                  };
                  map[targetKey] = {
                    finding: syntheticFinding,
                    criticStages: createInitialCriticStages(),
                  };
                }

                map[targetKey] = {
                  ...map[targetKey],
                  target: {
                    ...target,
                    findingId: targetKey,
                  },
                };
                if (map[targetKey].finding.status === 'DISCOVERED') {
                  map[targetKey].finding.status = 'PLANNED';
                }
              }
            });

            return map;
          });

          if (rawFindings.length > 0) {
            setActiveFindingId((prev) => prev ?? rawFindings[0].id ?? rawFindings[0].findingId ?? null);
          } else if (planTargets.length > 0) {
            setActiveFindingId((prev) => prev ?? planTargets[0].targetId);
          }
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load scan details');
      } finally {
        setIsLoading(false);
      }
    },
    [provider]
  );

  const fetchScanDataRef = useRef(fetchScanData);
  fetchScanDataRef.current = fetchScanData;

  // Subscribe to events when active scan is selected
  useEffect(() => {
    if (!activeScanId) return;

    setAgents(INITIAL_AGENTS);
    setFindingsById({});
    setEvents([]);
    setLastSequence(0);
    setConnectionStatus('CONNECTED');
    setSandbox(null);
    setActiveFindingId(null);

    fetchScanData(activeScanId);

    const unsubscribe = provider.subscribeEvents(activeScanId, handleEvent);

    return () => {
      unsubscribe();
    };
  }, [activeScanId, provider]);

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
      setFindingsById({});
      setEvents([]);
      setLastSequence(0);
      setSandbox(null);
      setActiveFindingId(null);
      fetchScanData(activeScanId);
    }
  }, [activeScanId, fetchScanData, provider]);

  const activeFinding = useMemo(() => {
    if (!activeFindingId) return findings[0] ?? null;
    return findings.find((f) => f.id === activeFindingId || f.findingId === activeFindingId) ?? findings[0] ?? null;
  }, [activeFindingId, findings]);

  const activeFindingCriticStages = useMemo(() => {
    const key = activeFindingId || activeFinding?.id || 'default';
    return criticMatrix[key] ?? INITIAL_CRITIC_STAGES;
  }, [activeFinding, activeFindingId, criticMatrix]);

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
      criticStages: activeFindingCriticStages,
      criticMatrix,
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
      activeFindingCriticStages,
      criticMatrix,
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
