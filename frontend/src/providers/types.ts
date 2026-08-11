/**
 * AMASS Data Provider Strategy Interface.
 * Provider boundary isolating REAL (REST + SSE) from DEMO MODE.
 */

import type { AmassEvent } from '../types/amass-events';
import type {
  ApiResponse,
  ScanModel,
  FindingModel,
  ScanStatistics,
  PlanModel,
} from '../types/api-types';

export type DemoTargetId = 'AskBit' | 'GeoSpy';
export type DemoScenarioId = 'full_approved' | 'critic_rejected';

export interface StartScanOptions {
  repositoryUrl?: string;
  demoTargetId?: DemoTargetId;
  scenarioId?: DemoScenarioId;
  speedMultiplier?: number;
}

export interface AMASSDataProvider {
  readonly isDemoMode: boolean;
  startScan(options: StartScanOptions): Promise<ApiResponse<ScanModel>>;
  getScan(scanId: string): Promise<ApiResponse<ScanModel>>;
  getScanResults(scanId: string): Promise<ApiResponse<{ scanId: string; findings: FindingModel[] }>>;
  getScanStatistics(scanId: string): Promise<ApiResponse<ScanStatistics>>;
  getPlanForScan(scanId: string): Promise<ApiResponse<PlanModel>>;
  subscribeEvents(scanId: string, onEvent: (event: AmassEvent) => void): () => void;
  stopActiveDemoScan?: () => void;
}
