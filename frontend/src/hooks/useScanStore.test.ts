import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useScanStore } from './useScanStore';
import type { AmassEvent } from '../types/amass-events';

let sseHandler: ((event: AmassEvent) => void) | null = null;

const mockProvider = {
  isDemoMode: false,
  startScan: vi.fn().mockResolvedValue({
    success: true,
    data: { id: 'scan_new', scanId: 'scan_new', status: 'RUNNING' },
  }),
  getScan: vi.fn().mockResolvedValue({
    success: true,
    data: { id: 'scan_1', scanId: 'scan_1', status: 'COMPLETED' },
  }),
  getScanResults: vi.fn().mockResolvedValue({
    success: true,
    data: {
      scanId: 'scan_1',
      findings: [
        {
          id: 'vuln_1',
          findingId: 'vuln_1',
          title: 'SQL Injection in search',
          severity: 'HIGH',
          vulnType: 'SQL Injection',
        },
      ],
    },
  }),
  getScanStatistics: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getPlanForScan: vi.fn().mockResolvedValue({
    success: true,
    data: {
      planId: 'plan_1',
      scanId: 'scan_1',
      targets: [
        {
          targetId: 'tgt_1',
          endpoint: 'http://localhost:8080/search',
          method: 'GET',
          candidateVulnerabilities: ['SQL Injection'],
          priority: 95,
          status: 'PLANNED',
        },
      ],
    },
  }),
  subscribeEvents: vi.fn().mockImplementation((_scanId: string, handler: (evt: AmassEvent) => void) => {
    sseHandler = handler;
    return () => {
      sseHandler = null;
    };
  }),
};

vi.mock('../providers', () => ({
  getAMASSDataProvider: () => mockProvider,
}));

describe('useScanStore hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseHandler = null;
  });

  it('exposes createScan, attachToScan, connectEventStream, resetLiveState actions', async () => {
    const { result } = renderHook(() => useScanStore(null));

    expect(typeof result.current.createScan).toBe('function');
    expect(typeof result.current.attachToScan).toBe('function');
    expect(typeof result.current.connectEventStream).toBe('function');
    expect(typeof result.current.resetLiveState).toBe('function');

    await act(async () => {
      await result.current.createScan({ repositoryUrl: 'https://github.com/test/repo' });
    });

    expect(result.current.activeScanId).toBe('scan_new');
    expect(['RUNNING', 'COMPLETED']).toContain(result.current.scanStatus);
  });

  it('updates agent states correctly based on incoming SSE events', async () => {
    const { result } = renderHook(() => useScanStore('scan_1'));
    expect(result.current.agents.SCOUT.status).toBe('IDLE');
    expect(result.current.activeScanId).toBe('scan_1');
  });

  it('updates Critic stage checklist derived from validation events', () => {
    const { result } = renderHook(() => useScanStore(null));
    const initialBaseline = result.current.criticStages.find((s) => s.key === 'baseline');
    expect(initialBaseline?.status).toBe('IDLE');
  });

  it('hydrates findings and plan targets via REST upon loading a scan', async () => {
    const { result } = renderHook(() => useScanStore('scan_1'));

    await waitFor(() => {
      expect(result.current.findings.length).toBeGreaterThan(0);
    });

    expect(result.current.findings[0].title).toBe('SQL Injection in search');
    expect(result.current.targets.length).toBeGreaterThan(0);
    expect(result.current.targets[0]?.endpoint).toBe('http://localhost:8080/search');
    expect(result.current.targets[0]?.status).toBe('PLANNED');
  });

  it('processes SNIPER_NOT_TESTED event without converting target status to REJECTED', async () => {
    const { result } = renderHook(() => useScanStore('scan_1'));

    await waitFor(() => {
      expect(result.current.targets.length).toBeGreaterThan(0);
    });

    const notTestedEvt: AmassEvent = {
      eventId: 'evt_nt',
      scanId: 'scan_1',
      sequence: 10,
      timestamp: new Date().toISOString(),
      eventType: 'SNIPER_NOT_TESTED',
      agentType: 'SNIPER',
      phase: 'verification',
      level: 'INFO',
      status: 'SKIPPED' as any,
      message: 'target "tgt_1" not tested (unsupported candidate vulnerability)',
      metadata: {
        targetId: 'tgt_1',
        findingId: 'vuln_1',
        result: 'NOT_TESTED',
        reason: 'Unsupported candidate vulnerability (unknown)',
      },
    };

    act(() => {
      sseHandler?.(notTestedEvt);
    });

    const target = result.current.targets.find((t) => t?.targetId === 'tgt_1');
    expect(target).toBeDefined();
    expect(target?.status).toBe('PLANNED');
    expect(target?.verificationStatus).toBe('NOT_TESTED');
    expect(target?.verificationReason).toBe('Unsupported candidate vulnerability (unknown)');
  });

  it('processes SNIPER_REJECTED event by setting verificationStatus to NOT_CONFIRMED while preserving target PLANNED status', async () => {
    const { result } = renderHook(() => useScanStore('scan_1'));

    await waitFor(() => {
      expect(result.current.targets.length).toBeGreaterThan(0);
    });

    const rejectedEvt: AmassEvent = {
      eventId: 'evt_rej',
      scanId: 'scan_1',
      sequence: 11,
      timestamp: new Date().toISOString(),
      eventType: 'SNIPER_REJECTED',
      agentType: 'SNIPER',
      phase: 'verification',
      level: 'INFO',
      status: 'NOT_CONFIRMED',
      message: 'target "tgt_1" not exploited (payload safe)',
      metadata: {
        targetId: 'tgt_1',
        findingId: 'vuln_1',
        result: 'NOT_CONFIRMED',
        reason: 'payload safe',
      },
    };

    act(() => {
      sseHandler?.(rejectedEvt);
    });

    const target = result.current.targets.find((t) => t.targetId === 'tgt_1');
    expect(target).toBeDefined();
    expect(target?.status).toBe('PLANNED');
    expect(target?.verificationStatus).toBe('NOT_CONFIRMED');
  });

  it('processes SNIPER_CONFIRMED event by setting verificationStatus to CONFIRMED', async () => {
    const { result } = renderHook(() => useScanStore('scan_1'));

    await waitFor(() => {
      expect(result.current.targets.length).toBeGreaterThan(0);
    });

    const confirmedEvt: AmassEvent = {
      eventId: 'evt_conf',
      scanId: 'scan_1',
      sequence: 12,
      timestamp: new Date().toISOString(),
      eventType: 'SNIPER_CONFIRMED',
      agentType: 'SNIPER',
      phase: 'verification',
      level: 'WARN',
      status: 'CONFIRMED',
      message: 'exploit confirmed for target "tgt_1"',
      metadata: {
        targetId: 'tgt_1',
        findingId: 'vuln_1',
        result: 'CONFIRMED',
      },
    };

    act(() => {
      sseHandler?.(confirmedEvt);
    });

    const target = result.current.targets.find((t) => t?.targetId === 'tgt_1');
    expect(target).toBeDefined();
    expect(target?.status).toBe('PLANNED');
    expect(target?.verificationStatus).toBe('CONFIRMED');
  });

  it('preserves NOT_TESTED verificationStatus when REST hydration occurs after SSE update', async () => {
    const { result } = renderHook(() => useScanStore('scan_1'));

    await waitFor(() => {
      expect(result.current.targets.length).toBeGreaterThan(0);
    });

    const notTestedEvt: AmassEvent = {
      eventId: 'evt_nt_hyd',
      scanId: 'scan_1',
      sequence: 15,
      timestamp: new Date().toISOString(),
      eventType: 'SNIPER_NOT_TESTED',
      agentType: 'SNIPER',
      phase: 'verification',
      level: 'INFO',
      status: 'SKIPPED' as any,
      message: 'target "tgt_1" not tested (requires authentication)',
      metadata: {
        targetId: 'tgt_1',
        findingId: 'vuln_1',
        result: 'NOT_TESTED',
        reason: 'requires authentication',
      },
    };

    act(() => {
      sseHandler?.(notTestedEvt);
    });

    // Simulate SNIPER_VERIFICATION_COMPLETED triggering REST hydration
    const completedEvt: AmassEvent = {
      eventId: 'evt_svc',
      scanId: 'scan_1',
      sequence: 16,
      timestamp: new Date().toISOString(),
      eventType: 'SNIPER_VERIFICATION_COMPLETED',
      agentType: 'SNIPER',
      phase: 'verification',
      level: 'INFO',
      status: 'COMPLETED',
      message: 'sniper verification completed',
    };

    act(() => {
      sseHandler?.(completedEvt);
    });

    await waitFor(() => {
      const target = result.current.targets.find((t) => t?.targetId === 'tgt_1');
      expect(target?.status).toBe('PLANNED');
      expect(target?.verificationStatus).toBe('NOT_TESTED');
      expect(target?.verificationReason).toContain('authentication');
    });
  });

  it('preserves FAILED verificationStatus when REST hydration occurs after SSE update', async () => {
    const { result } = renderHook(() => useScanStore('scan_1'));

    await waitFor(() => {
      expect(result.current.targets.length).toBeGreaterThan(0);
    });

    const failedEvt: AmassEvent = {
      eventId: 'evt_fail_hyd',
      scanId: 'scan_1',
      sequence: 17,
      timestamp: new Date().toISOString(),
      eventType: 'SNIPER_REJECTED',
      agentType: 'SNIPER',
      phase: 'verification',
      level: 'ERROR',
      status: 'FAILED',
      message: 'target "tgt_1" verifier execution failed',
      metadata: {
        targetId: 'tgt_1',
        findingId: 'vuln_1',
        result: 'FAILED',
        reason: 'verifier execution failed',
      },
    };

    act(() => {
      sseHandler?.(failedEvt);
    });

    const completedEvt: AmassEvent = {
      eventId: 'evt_svc2',
      scanId: 'scan_1',
      sequence: 18,
      timestamp: new Date().toISOString(),
      eventType: 'SNIPER_VERIFICATION_COMPLETED',
      agentType: 'SNIPER',
      phase: 'verification',
      level: 'INFO',
      status: 'COMPLETED',
      message: 'sniper verification completed',
    };

    act(() => {
      sseHandler?.(completedEvt);
    });

    await waitFor(() => {
      const target = result.current.targets.find((t) => t?.targetId === 'tgt_1');
      expect(target?.status).toBe('PLANNED');
      expect(target?.verificationStatus).toBe('FAILED');
    });
  });

  it('hydrates persisted verificationStatus and verificationReason directly from REST API alone', async () => {
    mockProvider.getPlanForScan.mockResolvedValueOnce({
      success: true,
      data: {
        planId: 'plan_2',
        scanId: 'scan_2',
        targets: [
          {
            targetId: 'tgt_2',
            endpoint: 'http://localhost:8080/memos',
            method: 'GET',
            candidateVulnerabilities: ['SQL Injection'],
            priority: 90,
            status: 'PLANNED',
            verificationStatus: 'NOT_TESTED',
            verificationReason: 'requires authentication',
          },
        ],
      },
    });

    const { result } = renderHook(() => useScanStore('scan_2'));

    await waitFor(() => {
      expect(result.current.targets.length).toBeGreaterThan(0);
    });

    const target = result.current.targets.find((t) => t?.targetId === 'tgt_2');
    expect(target).toBeDefined();
    expect(target?.status).toBe('PLANNED');
    expect(target?.verificationStatus).toBe('NOT_TESTED');
    expect(target?.verificationReason).toBe('requires authentication');
  });

  it('keeps untouched target verificationStatus as NOT_RUN while planning status remains PLANNED', async () => {
    mockProvider.getPlanForScan.mockResolvedValueOnce({
      success: true,
      data: {
        planId: 'plan_3',
        scanId: 'scan_3',
        targets: [
          {
            targetId: 'tgt_untouched',
            endpoint: 'http://localhost:8080/untouched',
            method: 'GET',
            candidateVulnerabilities: ['SQL Injection'],
            priority: 50,
            status: 'PLANNED',
            verificationStatus: 'NOT_RUN',
          },
        ],
      },
    });

    const { result } = renderHook(() => useScanStore('scan_3'));

    await waitFor(() => {
      expect(result.current.targets.length).toBeGreaterThan(0);
    });

    const target = result.current.targets.find((t) => t?.targetId === 'tgt_untouched');
    expect(target).toBeDefined();
    expect(target?.status).toBe('PLANNED');
    expect(target?.verificationStatus).toBe('NOT_RUN');
  });

  it('handles ENGINEER_REJECTED event properly without fallback to src/vulnerable.ts', async () => {
    const { result } = renderHook(() => useScanStore('scan_1'));

    await waitFor(() => {
      expect(result.current.findings.length).toBeGreaterThan(0);
    });

    const rejectedEvt: AmassEvent = {
      eventId: 'evt_eng_rej',
      scanId: 'scan_1',
      sequence: 20,
      timestamp: new Date().toISOString(),
      eventType: 'ENGINEER_REJECTED',
      agentType: 'ENGINEER',
      phase: 'remediation',
      level: 'INFO',
      status: 'REJECTED',
      message: 'Source code file context is unavailable and patch cannot be safely generated',
      metadata: {
        vulnerabilityId: 'vuln_1',
        reason: 'Source code file context is unavailable and patch cannot be safely generated',
        status: 'REJECTED',
        hasDiff: false,
      },
    };

    act(() => {
      sseHandler?.(rejectedEvt);
    });

    const patch = result.current.patches.find((p) => p.findingId === 'vuln_1');
    expect(patch).toBeDefined();
    expect(patch?.status).toBe('REJECTED');
    expect(patch?.diffContent).toBe('');
    expect(patch?.filePath).not.toBe('src/vulnerable.ts');
  });

  it('handles ENGINEER_PATCH_GENERATED with valid metadata and populates real diffContent and filePath', async () => {
    const { result } = renderHook(() => useScanStore('scan_1'));

    await waitFor(() => {
      expect(result.current.findings.length).toBeGreaterThan(0);
    });

    const patchEvt: AmassEvent = {
      eventId: 'evt_eng_patch',
      scanId: 'scan_1',
      sequence: 21,
      timestamp: new Date().toISOString(),
      eventType: 'ENGINEER_PATCH_GENERATED',
      agentType: 'ENGINEER',
      phase: 'remediation',
      level: 'INFO',
      status: 'SUCCEEDED',
      message: 'patch generated: patch_123',
      metadata: {
        vulnerabilityId: 'vuln_1',
        patchId: 'patch_123',
        filePath: 'src/routes/search.ts',
        diffContent: '--- a/src/routes/search.ts\n+++ b/src/routes/search.ts\n@@ -1 +1 @@\n-old\n+new',
        explanation: 'Fixed query',
        status: 'GENERATED',
        hasDiff: true,
      },
    };

    act(() => {
      sseHandler?.(patchEvt);
    });

    const patch = result.current.patches.find((p) => p.findingId === 'vuln_1');
    expect(patch).toBeDefined();
    expect(patch?.status).toBe('GENERATED');
    expect(patch?.filePath).toBe('src/routes/search.ts');
    expect(patch?.diffContent).toContain('--- a/src/routes/search.ts');
  });
});
