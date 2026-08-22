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
  REMEDIATION: { type: 'REMEDIATION', status: 'IDLE' },
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
      .map((record) => {
        if (!record.target) return null;
        let vStatus = record.target.verificationStatus ?? 'NOT_RUN';
        let vReason = record.target.verificationReason;

        if (record.exploit && (vStatus === 'NOT_RUN' || !vStatus)) {
          vStatus = record.exploit.status || (record.exploit.confirmed ? 'CONFIRMED' : 'NOT_CONFIRMED');
          vReason = record.exploit.verificationNotes || (record.exploit as any).reason || vReason;
        }

        return {
          ...record.target,
          status: record.target.status ?? 'PLANNED',
          verificationStatus: vStatus,
          verificationReason: vReason,
        } as TargetModel;
      })
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
      setAgents((prev) => {
        const evType = event.eventType;
        const status = event.status;
        const agentKey = event.agentType;

        const next = { ...prev };

        // Handle cross-agent workflow triggers
        if (evType === 'CRITIC_APPROVED') {
          next.CRITIC = { type: 'CRITIC', status: 'COMPLETED', lastMessage: event.message, updatedAt: event.timestamp };
          if (next.REMEDIATION.status !== 'COMPLETED') {
            next.REMEDIATION = { type: 'REMEDIATION', status: 'RUNNING', lastMessage: 'Remediation Delivery in progress...', updatedAt: event.timestamp };
          }
        } else if (evType === 'REMEDIATION_PR_CREATED') {
          next.REMEDIATION = { type: 'REMEDIATION', status: 'COMPLETED', lastMessage: event.message, updatedAt: event.timestamp };
        } else if (evType === 'REMEDIATION_DELIVERY_FAILED') {
          next.REMEDIATION = { type: 'REMEDIATION', status: 'FAILED', lastMessage: event.message, updatedAt: event.timestamp };
        }

        if (agentKey && next[agentKey]) {
          const current = next[agentKey];
          let nextStatus: AgentStatus = current?.status ?? 'IDLE';

          // RUNNING transitions
          if (
            evType.endsWith('_STARTED') ||
            status === 'STARTED' ||
            status === 'IN_PROGRESS' ||
            evType === 'SCANNER_FINDING_DISCOVERED' ||
            evType === 'SANDBOX_PROVISIONING' ||
            evType === 'SCOUT_ENDPOINT_DISCOVERED' ||
            evType === 'SNIPER_TARGET_SELECTED' ||
            evType === 'SNIPER_VERIFICATION_STARTED' ||
            evType === 'SNIPER_CONFIRMED' ||
            evType === 'SNIPER_REJECTED' ||
            evType === 'SNIPER_NOT_TESTED' ||
            evType === 'ENGINEER_SOURCE_READ' ||
            evType === 'ENGINEER_RAG_STARTED' ||
            evType === 'ENGINEER_RAG_COMPLETED' ||
            evType === 'ENGINEER_LLM_STARTED' ||
            evType === 'ENGINEER_LLM_COMPLETED' ||
            evType === 'BASELINE_CHECK_STARTED' ||
            evType === 'BASELINE_CHECK_COMPLETED' ||
            evType === 'PATCH_APPLY_STARTED' ||
            evType === 'PATCH_APPLIED' ||
            evType === 'BUILD_STARTED' ||
            evType === 'BUILD_COMPLETED' ||
            evType === 'TESTS_STARTED' ||
            evType === 'TESTS_COMPLETED' ||
            evType === 'EXPLOIT_RETEST_STARTED' ||
            evType === 'EXPLOIT_RETEST_COMPLETED'
          ) {
            nextStatus = 'RUNNING';
          }

          // COMPLETED transitions
          if (
            evType === 'ANALYZER_COMPLETED' ||
            evType === 'SCANNER_COMPLETED' ||
            (agentKey === 'SANDBOX' && (evType === 'SANDBOX_READY' || status === 'READY')) ||
            evType === 'SCOUT_COMPLETED' ||
            evType === 'PLANNER_COMPLETED' ||
            evType === 'SNIPER_VERIFICATION_COMPLETED' ||
            evType === 'ENGINEER_PATCH_GENERATED' ||
            evType === 'ENGINEER_REJECTED' ||
            evType === 'ENGINEER_COMPLETED' ||
            (agentKey === 'CRITIC' && (evType === 'CRITIC_APPROVED' || evType === 'CRITIC_REJECTED' || evType === 'CRITIC_COMPLETED')) ||
            (agentKey === 'REMEDIATION' && evType === 'REMEDIATION_PR_CREATED') ||
            (agentKey === 'SYSTEM' && evType === 'SCAN_COMPLETED')
          ) {
            nextStatus = 'COMPLETED';
          }

          // FAILED transitions
          if (
            evType.endsWith('_FAILED') ||
            status === 'FAILED' ||
            evType === 'ENGINEER_FAILED' ||
            evType === 'CRITIC_FAILED' ||
            evType === 'SANDBOX_FAILED' ||
            (agentKey === 'REMEDIATION' && evType === 'REMEDIATION_DELIVERY_FAILED')
          ) {
            nextStatus = 'FAILED';
          }

          next[agentKey] = {
            type: agentKey,
            status: nextStatus,
            lastMessage: event.message,
            updatedAt: event.timestamp,
          };
        }

        return next;
      });

      // 2. Workflow / Scan status update & Clean State Initialization at start
      if (event.eventType === 'SCAN_STARTED') {
        setScan((prev) => ({
          scanId: event.scanId,
          repositoryUrl: (event.metadata?.targetUrl as string) ?? prev?.repositoryUrl,
          status: 'RUNNING',
          startedAt: event.timestamp,
          isDemo: provider.isDemoMode,
        }));
        setFindingsById({});
        setSandbox(null);
        setActiveFindingId(null);
      } else if (event.eventType === 'SCAN_COMPLETED') {
        setScan((prev) => (prev ? { ...prev, status: 'COMPLETED', completedAt: event.timestamp } : { scanId: event.scanId, status: 'COMPLETED', startedAt: event.timestamp, completedAt: event.timestamp }));
      } else if (event.eventType === 'SCAN_FAILED') {
        setScan((prev) => (prev ? { ...prev, status: 'FAILED', completedAt: event.timestamp } : { scanId: event.scanId, status: 'FAILED', startedAt: event.timestamp, completedAt: event.timestamp }));
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
          if (targetFindingId || event.metadata?.targetId || event.metadata?.vulnerabilityId) {
            const tgtId = event.metadata?.targetId as string | undefined;
            const vulnId = (event.metadata?.findingId as string) || (event.metadata?.vulnerabilityId as string);
            const keyId = vulnId || tgtId || targetFindingId;
            const expMeta = (event.metadata?.exploit as ExploitEvidenceModel | undefined) ?? {
              exploitId: `exp_${keyId}`,
              targetId: tgtId || keyId,
              findingId: vulnId || keyId,
              scanId: event.scanId,
              confirmed: true,
              endpoint: event.metadata?.endpoint as string | undefined,
              method: (event.metadata?.method as string) ?? 'GET',
              verificationNotes: event.message,
            };
            setFindingsById((prev) => {
              const key = Object.keys(prev).find(
                (k) =>
                  (vulnId && (k === vulnId || prev[k].finding.id === vulnId)) ||
                  (tgtId && (k === tgtId || prev[k].target?.targetId === tgtId))
              ) || keyId;
              const record = prev[key];
              if (!record) {
                const newFinding: FindingModel = {
                  id: key,
                  findingId: key,
                  title: `SQL Injection at ${event.metadata?.endpoint || 'endpoint'}`,
                  severity: 'HIGH',
                  status: 'CONFIRMED',
                  isConfirmed: true,
                };
                return {
                  ...prev,
                  [key]: {
                    finding: newFinding,
                    exploit: expMeta,
                    criticStages: createInitialCriticStages(),
                  },
                };
              }
              return {
                ...prev,
                [key]: {
                  ...record,
                  exploit: expMeta,
                  finding: { ...record.finding, status: 'CONFIRMED', isConfirmed: true },
                  target: record.target ? {
                    ...record.target,
                    status: record.target.status ?? 'PLANNED',
                    verificationStatus: 'CONFIRMED',
                    verificationReason: event.message,
                  } : record.target,
                },
              };
            });
          }
          break;

        case 'SNIPER_NOT_TESTED':
        case 'SNIPER_REJECTED':
          if (targetFindingId) {
            const rawResult = (event.metadata?.result as string) || (event.eventType === 'SNIPER_NOT_TESTED' ? 'NOT_TESTED' : 'NOT_CONFIRMED');
            const vStatus = rawResult === 'REJECTED' ? 'NOT_CONFIRMED' : rawResult;
            const vReason = (event.metadata?.reason as string) || event.message;

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
              const findingStatus = vStatus === 'NOT_TESTED' ? record.finding.status : 'NOT_CONFIRMED';
              return {
                ...prev,
                [key]: {
                  ...record,
                  finding: { ...record.finding, status: findingStatus },
                  target: record.target ? {
                    ...record.target,
                    status: record.target.status ?? 'PLANNED',
                    verificationStatus: vStatus,
                    verificationReason: vReason,
                  } : record.target,
                },
              };
            });
          }
          break;

        // ENGINEER REMEDIATION PATCH
        case 'ENGINEER_PATCH_GENERATED':
          if (targetFindingId) {
            const rawDiff =
              (event.metadata?.diffContent as string) ||
              (event.metadata?.diff as string) ||
              '';
            const rawPath =
              (event.metadata?.filePath as string) ||
              (event.metadata?.file as string) ||
              '';

            if (rawDiff && rawPath) {
              const patchMeta: PatchModel = {
                patchId: (event.metadata?.patchId as string) ?? `patch_${targetFindingId}`,
                findingId: targetFindingId,
                scanId: event.scanId,
                filePath: rawPath,
                diffContent: rawDiff,
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
          }
          break;

        case 'ENGINEER_REJECTED':
          if (targetFindingId) {
            const rejectionReason =
              (event.metadata?.reason as string) ||
              event.message ||
              'Source code file context is unavailable and patch cannot be safely generated';

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
                  patch: {
                    patchId: `rejected_${targetFindingId}`,
                    findingId: targetFindingId,
                    scanId: event.scanId,
                    filePath: (event.metadata?.filePath as string) ?? '',
                    diffContent: '',
                    status: 'REJECTED',
                    explanation: rejectionReason,
                  },
                  finding: { ...record.finding, status: 'EXPLOIT_REJECTED' },
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

        // REMEDIATION PR DELIVERY OBSERVABILITY
        case 'REMEDIATION_PR_CREATED': {
          const pId = (event.metadata?.patchId as string) || '';
          const prNum = (event.metadata?.prNumber as number) ?? null;
          const prUrl = (event.metadata?.prUrl as string) ?? null;
          const prBranch = (event.metadata?.prBranch as string) ?? null;
          const prStatus = (event.metadata?.prStatus as string) ?? 'OPEN';

          setFindingsById((prev) => {
            const key =
              Object.keys(prev).find(
                (k) =>
                  k === targetFindingId ||
                  prev[k].patch?.patchId === pId ||
                  prev[k].finding.id === targetFindingId ||
                  prev[k].target?.targetId === targetFindingId
              ) || targetFindingId || Object.keys(prev)[0];

            if (!key || !prev[key]) return prev;
            const record = prev[key];
            const existingPatch = record.patch;

            const updatedPatch: PatchModel = existingPatch
              ? {
                  ...existingPatch,
                  prNumber: prNum ?? existingPatch.prNumber,
                  prUrl: prUrl ?? existingPatch.prUrl,
                  prBranch: prBranch ?? existingPatch.prBranch,
                  prStatus: prStatus ?? existingPatch.prStatus,
                  prDeliveredAt: event.timestamp,
                  prError: null,
                }
              : {
                  patchId: pId || `patch_${key}`,
                  findingId: key,
                  scanId: event.scanId,
                  filePath: (event.metadata?.filePath as string) || record.finding.filePath || '',
                  diffContent: '',
                  status: 'APPROVED',
                  prNumber: prNum,
                  prUrl: prUrl,
                  prBranch: prBranch,
                  prStatus: prStatus,
                  prDeliveredAt: event.timestamp,
                  prError: null,
                };

            return {
              ...prev,
              [key]: {
                ...record,
                patch: updatedPatch,
              },
            };
          });
          break;
        }

        case 'REMEDIATION_DELIVERY_FAILED': {
          const pId = (event.metadata?.patchId as string) || '';
          const err = (event.metadata?.error as string) || event.message || 'Remediation Delivery Failed';

          setFindingsById((prev) => {
            const key =
              Object.keys(prev).find(
                (k) =>
                  k === targetFindingId ||
                  prev[k].patch?.patchId === pId ||
                  prev[k].finding.id === targetFindingId ||
                  prev[k].target?.targetId === targetFindingId
              ) || targetFindingId || Object.keys(prev)[0];

            if (!key || !prev[key]) return prev;
            const record = prev[key];
            const existingPatch = record.patch;

            const updatedPatch: PatchModel = existingPatch
              ? {
                  ...existingPatch,
                  prError: err,
                }
              : {
                  patchId: pId || `patch_${key}`,
                  findingId: key,
                  scanId: event.scanId,
                  filePath: (event.metadata?.filePath as string) || record.finding.filePath || '',
                  diffContent: '',
                  status: 'APPROVED',
                  prError: err,
                };

            return {
              ...prev,
              [key]: {
                ...record,
                patch: updatedPatch,
              },
            };
          });
          break;
        }
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
              const isConfirmed = f.status === 'CONFIRMED' || f.status === 'EXPLOIT_CONFIRMED' || Boolean(f.isConfirmed);
              
              const restPatch: PatchModel | undefined = f.patch
                ? {
                    patchId: f.patch.id || f.patch.patchId || `patch_${fId}`,
                    findingId: fId,
                    scanId: scanId,
                    filePath: f.patch.filePath || f.file || 'src/vulnerable.ts',
                    diffContent: f.patch.diffContent || '',
                    status: f.patch.status || 'GENERATED',
                    explanation: f.patch.explanation || 'Automated defensive code patch.',
                    prNumber: (f.patch as any).prNumber ?? null,
                    prUrl: (f.patch as any).prUrl ?? null,
                    prBranch: (f.patch as any).prBranch ?? null,
                    prCommitSha: (f.patch as any).prCommitSha ?? null,
                    prStatus: (f.patch as any).prStatus ?? null,
                    prDeliveredAt: (f.patch as any).prDeliveredAt ?? null,
                    prError: (f.patch as any).prError ?? null,
                  }
                : undefined;

              if (!map[fId]) {
                map[fId] = {
                  finding: {
                    ...f,
                    id: fId,
                    findingId: fId,
                    status: f.status ?? 'DISCOVERED',
                    isConfirmed,
                  },
                  patch: restPatch,
                  criticStages: createInitialCriticStages(),
                };
              } else {
                const existingPatch = map[fId].patch;
                const mergedPatch = restPatch
                  ? {
                      ...existingPatch,
                      ...restPatch,
                      diffContent: restPatch.diffContent || existingPatch?.diffContent || '',
                      prNumber: restPatch.prNumber ?? existingPatch?.prNumber,
                      prUrl: restPatch.prUrl ?? existingPatch?.prUrl,
                      prBranch: restPatch.prBranch ?? existingPatch?.prBranch,
                      prCommitSha: restPatch.prCommitSha ?? existingPatch?.prCommitSha,
                      prStatus: restPatch.prStatus ?? existingPatch?.prStatus,
                      prDeliveredAt: restPatch.prDeliveredAt ?? existingPatch?.prDeliveredAt,
                      prError: restPatch.prError ?? existingPatch?.prError,
                    }
                  : existingPatch;

                map[fId] = {
                  ...map[fId],
                  finding: {
                    ...map[fId].finding,
                    ...f,
                    id: fId,
                    findingId: fId,
                    status: f.status ?? map[fId].finding.status,
                    isConfirmed: isConfirmed || map[fId].finding.isConfirmed,
                  },
                  patch: mergedPatch,
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
                    description: target.reason || `Target priority ${(target as any).priorityScore ?? (target as any).priority ?? 1}`,
                    severity: (target.estimatedRisk as any) || 'HIGH',
                    status: 'PLANNED',
                  };
                  map[targetKey] = {
                    finding: syntheticFinding,
                    criticStages: createInitialCriticStages(),
                  };
                }

                const existingTarget = map[targetKey].target;
                const incomingVStatus = target.verificationStatus && target.verificationStatus !== 'NOT_RUN' ? target.verificationStatus : undefined;
                const existingVStatus = existingTarget?.verificationStatus && existingTarget.verificationStatus !== 'NOT_RUN' ? existingTarget.verificationStatus : undefined;
                const finalVStatus = incomingVStatus ?? existingVStatus ?? target.verificationStatus ?? existingTarget?.verificationStatus ?? 'NOT_RUN';

                const finalVReason = incomingVStatus
                  ? target.verificationReason
                  : existingVStatus
                    ? existingTarget?.verificationReason
                    : target.verificationReason ?? existingTarget?.verificationReason;

                const nextFindingStatus = map[targetKey].finding.status === 'DISCOVERED' ? 'PLANNED' : map[targetKey].finding.status;
                map[targetKey] = {
                  ...map[targetKey],
                  finding: {
                    ...map[targetKey].finding,
                    status: nextFindingStatus,
                  },
                  target: {
                    ...existingTarget,
                    ...target,
                    findingId: targetKey,
                    status: (existingTarget?.status ?? target.status ?? 'PLANNED') as any,
                    verificationStatus: finalVStatus,
                    verificationReason: finalVReason,
                  },
                };
              }
            });

            const records = Object.values(map);
            const deliveredRecord = records.find((r) => r.patch?.prNumber || r.patch?.prUrl);
            const failedRecord = records.find((r) => r.patch?.prError && !r.patch?.prNumber);
            const approvedRecord = records.find(
              (r) => r.patch?.status === 'APPROVED' || r.patch?.status === 'CRITIC_VERIFIED' || r.finding.status === 'CRITIC_VERIFIED'
            );

            setAgents((prev) => {
              const next = { ...prev };
              if (deliveredRecord?.patch) {
                next.CRITIC = { ...next.CRITIC, type: 'CRITIC', status: 'COMPLETED', lastMessage: 'Critic approved patch' };
                next.REMEDIATION = {
                  type: 'REMEDIATION',
                  status: 'COMPLETED',
                  lastMessage: `PR #${deliveredRecord.patch.prNumber} created: ${deliveredRecord.patch.prUrl}`,
                };
              } else if (failedRecord?.patch) {
                next.CRITIC = { ...next.CRITIC, type: 'CRITIC', status: 'COMPLETED', lastMessage: 'Critic approved patch' };
                next.REMEDIATION = {
                  type: 'REMEDIATION',
                  status: 'FAILED',
                  lastMessage: failedRecord.patch.prError || 'PR delivery failed',
                };
              } else if (approvedRecord) {
                next.CRITIC = { ...next.CRITIC, type: 'CRITIC', status: 'COMPLETED', lastMessage: 'Critic approved patch' };
                if (next.REMEDIATION.status !== 'COMPLETED') {
                  next.REMEDIATION = {
                    type: 'REMEDIATION',
                    status: 'RUNNING',
                    lastMessage: 'Remediation Delivery in progress...',
                  };
                }
              }
              return next;
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

  const resetLiveState = useCallback(() => {
    setAgents(INITIAL_AGENTS);
    setFindingsById({});
    setEvents([]);
    setLastSequence(0);
    setConnectionStatus('CONNECTED');
    setSandbox(null);
    setActiveFindingId(null);
    setScan(null);
    setError(null);
    setIsLoading(false);
  }, []);

  const connectEventStream = useCallback(
    (scanId: string) => {
      if (!scanId) return () => {};
      setConnectionStatus('CONNECTED');
      return provider.subscribeEvents(scanId, handleEvent);
    },
    [handleEvent, provider]
  );

  const attachToScan = useCallback(
    (scanId: string) => {
      if (!scanId) return;
      setActiveScanId(scanId);
      resetLiveState();
      setScan({
        scanId,
        status: 'RUNNING',
        startedAt: new Date().toISOString(),
        isDemo: provider.isDemoMode,
      });
      fetchScanData(scanId);
    },
    [fetchScanData, provider.isDemoMode, resetLiveState]
  );

  const createScan = useCallback(
    async (options: StartScanOptions) => {
      resetLiveState();
      setError(null);

      try {
        const res = await provider.startScan(options);
        if (res.success && res.data) {
          const newScanId = res.data.scanId || res.data.id;
          if (newScanId) {
            attachToScan(newScanId);
          }
        } else if (res.error) {
          setError(res.error.message);
        }
        return res;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Error starting scan';
        setError(message);
        return {
          success: false,
          data: null,
          error: { code: 'START_SCAN_ERROR', message },
          timestamp: new Date().toISOString(),
        };
      }
    },
    [attachToScan, provider, resetLiveState]
  );

  // Subscribe to events when active scan is selected
  useEffect(() => {
    if (!activeScanId) return;

    fetchScanData(activeScanId);
    const unsubscribe = connectEventStream(activeScanId);

    return () => {
      unsubscribe();
    };
  }, [activeScanId, connectEventStream, fetchScanData]);

  const selectScan = useCallback((scanId: string) => {
    attachToScan(scanId);
  }, [attachToScan]);

  const startScan = createScan;

  const startDemoScan = useCallback(
    async (targetId: DemoTargetId, scenarioId: DemoScenarioId, speedMultiplier: number = 1.0) => {
      if ('setDemoConfig' in provider && typeof (provider as any).setDemoConfig === 'function') {
        (provider as any).setDemoConfig(targetId, scenarioId, speedMultiplier);
      }
      return createScan({ demoTargetId: targetId, scenarioId, speedMultiplier });
    },
    [createScan, provider]
  );

  const resetDemoScan = useCallback(() => {
    if ('stopActiveDemoScan' in provider && typeof (provider as any).stopActiveDemoScan === 'function') {
      (provider as any).stopActiveDemoScan();
    }
    if (activeScanId) {
      attachToScan(activeScanId);
    }
  }, [activeScanId, attachToScan, provider]);

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
      resetLiveState,
      connectEventStream,
      attachToScan,
      createScan,
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
      resetLiveState,
      connectEventStream,
      attachToScan,
      createScan,
      selectScan,
      startScan,
      startDemoScan,
      resetDemoScan,
      fetchScanData,
    ]
  );

  return value;
}
