import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useScanStore } from './useScanStore';

vi.mock('../api/client', () => ({
  api: {
    getScan: vi.fn().mockResolvedValue({ success: true, data: { id: 'scan_1', status: 'RUNNING' } }),
    getScanResults: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getScanStatistics: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getPlanForScan: vi.fn().mockResolvedValue({ success: true, data: { targets: [] } }),
  },
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
});
