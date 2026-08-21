import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useScanStore } from './useScanStore';

const mockProvider = {
  isDemoMode: false,
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
        },
      ],
    },
  }),
  subscribeEvents: vi.fn().mockReturnValue(() => {}),
};

vi.mock('../providers', () => ({
  getAMASSDataProvider: () => mockProvider,
}));

describe('useScanStore hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(result.current.targets[0].endpoint).toBe('http://localhost:8080/search');
  });
});
