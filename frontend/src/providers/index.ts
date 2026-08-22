/**
 * AMASS Provider Strategy Registry & Smart Router.
 * 
 * Automatically routes scans based on repository URL:
 *   - https://github.com/Mayuresh1004/AskBit -> AskBit Demo Scenario
 *   - https://github.com/Mayuresh1004/geospy -> GeoSpy Demo Scenario
 *   - Everything else -> Real Production NON-DEMO Backend Run
 */

import type { AMASSDataProvider, StartScanOptions } from './types';
import type { AmassEvent } from '../types/amass-events';
import type { ApiResponse, ScanModel, FindingModel, ScanStatistics, PlanModel } from '../types/api-types';
import { realDataProvider } from './RealDataProvider';
import { demoDataProvider } from './DemoDataProvider';

export class SmartAMASSDataProvider implements AMASSDataProvider {
  private activeScanProviders: Map<string, AMASSDataProvider> = new Map();
  private currentProvider: AMASSDataProvider = realDataProvider;

  get isDemoMode(): boolean {
    return this.currentProvider.isDemoMode;
  }

  async startScan(options: StartScanOptions): Promise<ApiResponse<ScanModel>> {
    // Only route to demoDataProvider if explicitly requested via demoTargetId option.
    // Standard scan path routes through realDataProvider (Real Production Backend).
    if (options.demoTargetId) {
      const target = options.demoTargetId;
      demoDataProvider.setDemoConfig(target, options.scenarioId ?? 'full_approved', options.speedMultiplier ?? 1.0);
      this.currentProvider = demoDataProvider;
      const res = await demoDataProvider.startScan(options);
      if (res.success && res.data) {
        const scanId = res.data.scanId || res.data.id || '';
        if (scanId) this.activeScanProviders.set(scanId, demoDataProvider);
      }
      return res;
    } else {
      // NORMAL PATH: REAL PRODUCTION BACKEND RUN
      this.currentProvider = realDataProvider;
      const res = await realDataProvider.startScan(options);
      if (res.success && res.data) {
        const scanId = res.data.scanId || res.data.id || '';
        if (scanId) this.activeScanProviders.set(scanId, realDataProvider);
      }
      return res;
    }
  }

  private getProviderForScan(scanId: string): AMASSDataProvider {
    return this.activeScanProviders.get(scanId) || this.currentProvider;
  }

  async getScan(scanId: string): Promise<ApiResponse<ScanModel>> {
    return this.getProviderForScan(scanId).getScan(scanId);
  }

  async getScanResults(scanId: string): Promise<ApiResponse<{ scanId: string; findings: FindingModel[] }>> {
    return this.getProviderForScan(scanId).getScanResults(scanId);
  }

  async getScanStatistics(scanId: string): Promise<ApiResponse<ScanStatistics>> {
    return this.getProviderForScan(scanId).getScanStatistics(scanId);
  }

  async getPlanForScan(scanId: string): Promise<ApiResponse<PlanModel>> {
    return this.getProviderForScan(scanId).getPlanForScan(scanId);
  }

  subscribeEvents(scanId: string, onEvent: (event: AmassEvent) => void): () => void {
    return this.getProviderForScan(scanId).subscribeEvents(scanId, onEvent);
  }

  stopActiveDemoScan() {
    demoDataProvider.stopActiveDemoScan();
  }
}

export const smartAMASSDataProvider = new SmartAMASSDataProvider();

export function getAMASSDataProvider(): AMASSDataProvider {
  return smartAMASSDataProvider;
}

export function isDemoModeActive(): boolean {
  return smartAMASSDataProvider.isDemoMode;
}

export * from './types';
export { realDataProvider, demoDataProvider };
