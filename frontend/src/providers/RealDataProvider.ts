/**
 * Real AMASS Data Provider — Interfaces with production REST endpoints & SSE streams.
 */

import { api } from '../api/client';
import type { AMASSDataProvider, StartScanOptions } from './types';
import type { AmassEvent } from '../types/amass-events';
import type { ApiResponse, ScanModel, FindingModel, ScanStatistics, PlanModel } from '../types/api-types';

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:3001';

export class RealDataProvider implements AMASSDataProvider {
  readonly isDemoMode = false;

  async startScan(options: StartScanOptions): Promise<ApiResponse<ScanModel>> {
    const url = options.repositoryUrl || 'https://github.com/Mayuresh1004/AskBit';
    return api.createStaticScan({ url });
  }

  async getScan(scanId: string): Promise<ApiResponse<ScanModel>> {
    return api.getScan(scanId);
  }

  async getScanResults(scanId: string): Promise<ApiResponse<{ scanId: string; findings: FindingModel[] }>> {
    return api.getScanResults(scanId);
  }

  async getScanStatistics(scanId: string): Promise<ApiResponse<ScanStatistics>> {
    return api.getScanStatistics(scanId);
  }

  async getPlanForScan(scanId: string): Promise<ApiResponse<PlanModel>> {
    return api.getPlanForScan(scanId);
  }

  subscribeEvents(scanId: string, onEvent: (event: AmassEvent) => void): () => void {
    if (!scanId) return () => {};

    const url = `${API_BASE_URL}/api/scans/${scanId}/events`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as AmassEvent;
        onEvent(parsed);
      } catch (err) {
        console.error('Failed to parse SSE event message', err);
      }
    };

    return () => {
      eventSource.close();
    };
  }
}

export const realDataProvider = new RealDataProvider();
