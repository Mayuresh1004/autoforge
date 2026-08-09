/**
 * AMASS Strongly Typed REST API Client.
 *
 * Interacts with actual backend routes:
 *   - Health & Version (/health, /version)
 *   - Static Scans (/api/scan/static, /api/scan/:id, /api/scan/:id/results, /api/scan/:id/statistics)
 *   - Scout Agent (/api/scout/run, /api/scout/:id, /api/scout/:id/endpoints)
 *   - Attack Planner (/api/planner/run, /api/planner/plans/:planId, /api/planner/scans/:scanId)
 *   - Sniper Agent (/api/sniper/run, /api/sniper/:id, /api/sniper/targets/:targetId)
 *   - Patch Engineer (/api/engineer/run, /api/engineer/:executionId)
 *   - Runtime Sandbox (/api/sandboxes/runtime, /api/sandboxes/runtime/:id)
 *   - Repository Analysis (/api/repository/analyze)
 */

import type {
  ApiResponse,
  HealthData,
  VersionData,
  ScanModel,
  FindingModel,
  ScanStatistics,
  ScoutRunResult,
  ScoutEndpoint,
  PlanModel,
  ExploitEvidenceModel,
  PatchModel,
  RuntimeSandboxModel,
  SniperRunReportModel,
} from '../types/api-types';

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:3001';

async function fetchJson<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options?.headers ?? {}),
      },
      ...options,
    });

    const data = await res.json();
    if (!res.ok && !data.error) {
      return {
        success: false,
        data: null,
        error: {
          code: `HTTP_${res.status}`,
          message: data.message || `Server returned HTTP ${res.status}`,
          details: data.details,
        },
        timestamp: new Date().toISOString(),
      };
    }
    return data;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network request failed';
    return {
      success: false,
      data: null,
      error: { code: 'NETWORK_ERROR', message },
      timestamp: new Date().toISOString(),
    };
  }
}

export const api = {
  // System Health
  getHealth: () => fetchJson<HealthData>('/health'),
  getVersion: () => fetchJson<VersionData>('/version'),

  // Static Scans — Backend schema expects { url: string }
  createStaticScan: (payload: { url: string }) =>
    fetchJson<ScanModel>('/api/scan/static', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getScan: (scanId: string) => fetchJson<ScanModel>(`/api/scan/${scanId}`),

  getScanResults: (scanId: string) => fetchJson<{ scanId: string; findings: FindingModel[] }>(`/api/scan/${scanId}/results`),

  getScanStatistics: (scanId: string) => fetchJson<ScanStatistics>(`/api/scan/${scanId}/statistics`),

  // Scout Recon Agent
  runScout: (payload: { scanId: string; targetUrl?: string }) =>
    fetchJson<ScoutRunResult>('/api/scout/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getScoutRun: (scoutScanId: string) => fetchJson<ScoutRunResult>(`/api/scout/${scoutScanId}`),

  getScoutEndpoints: (scoutScanId: string) => fetchJson<ScoutEndpoint[]>(`/api/scout/${scoutScanId}/endpoints`),

  // Planner Agent
  runPlanner: (payload: { scanId: string }) =>
    fetchJson<PlanModel>('/api/planner/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getPlan: (planId: string) => fetchJson<PlanModel>(`/api/planner/plans/${planId}`),

  getPlanForScan: (scanId: string) => fetchJson<PlanModel>(`/api/planner/scans/${scanId}`),

  // Sniper Exploitation Agent
  runSniper: (payload: { scanId: string; sandboxId: string; baseUrl: string; targetIds: string[] }) =>
    fetchJson<SniperRunReportModel>('/api/sniper/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getSniperRun: (sniperRunId: string) => fetchJson<ExploitEvidenceModel>(`/api/sniper/${sniperRunId}`),

  getSniperTargetExploits: (targetId: string) => fetchJson<ExploitEvidenceModel[]>(`/api/sniper/targets/${targetId}`),

  // Engineer Patch Agent
  runEngineer: (payload: { scanId: string; findingId?: string; vulnerabilityId?: string }) =>
    fetchJson<PatchModel>('/api/engineer/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getEngineerRun: (executionId: string) => fetchJson<PatchModel>(`/api/engineer/${executionId}`),

  // Runtime Sandbox
  createRuntimeSandbox: (payload: { scanId: string; repository: { url?: string; path?: string } }) =>
    fetchJson<RuntimeSandboxModel>('/api/sandboxes/runtime', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getRuntimeSandbox: (id: string) => fetchJson<RuntimeSandboxModel>(`/api/sandboxes/runtime/${id}`),

  checkRuntimeSandboxHealth: (id: string) =>
    fetchJson<{ healthy: boolean; details?: string }>(`/api/sandboxes/runtime/${id}/health`, {
      method: 'POST',
    }),

  destroyRuntimeSandbox: (id: string) =>
    fetchJson<{ destroyed: boolean }>(`/api/sandboxes/runtime/${id}`, {
      method: 'DELETE',
    }),
};
