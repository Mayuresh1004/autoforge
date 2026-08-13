/**
 * AMASS Demo Data Provider — Completely isolated demonstration adapter.
 * Feeds exact Phase 9 AmassEvent schema and fixtures into the frontend.
 * 
 * Strict Event-Driven State Reduction:
 * Exposed state (findings, targets, endpoints, exploits, patches, sandbox) is
 * revealed ONLY dynamically as AmassEvents arrive from the event stream.
 */

import type { AMASSDataProvider, StartScanOptions, DemoTargetId, DemoScenarioId } from './types';
import type { AmassEvent } from '../types/amass-events';
import type {
  ApiResponse,
  ScanModel,
  FindingModel,
  TargetModel,
  ScanStatistics,
  PlanModel,
  ScoutEndpoint,
  ExploitEvidenceModel,
  PatchModel,
  RuntimeSandboxModel,
} from '../types/api-types';
import { DEMO_FIXTURES, ASKBIT_FIXTURE } from '../demo/fixtures';
import { DemoRunner } from '../demo/demoRunner';

export class DemoDataProvider implements AMASSDataProvider {
  readonly isDemoMode = true;

  private activeTargetId: DemoTargetId = 'AskBit';
  private activeScenarioId: DemoScenarioId = 'full_approved';
  private activeSpeedMultiplier = 1.0;
  private currentRunner: DemoRunner | null = null;

  private eventSubscribers: Set<(event: AmassEvent) => void> = new Set();

  // Dynamic Event-Revealed State
  private scanState: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED' = 'IDLE';
  private revealedFindings: FindingModel[] = [];
  private revealedTargets: TargetModel[] = [];
  private revealedEndpoints: ScoutEndpoint[] = [];
  private revealedExploits: ExploitEvidenceModel[] = [];
  private revealedPatches: PatchModel[] = [];
  private currentSandbox: RuntimeSandboxModel | null = null;

  constructor(targetId: DemoTargetId = 'AskBit', scenarioId: DemoScenarioId = 'full_approved') {
    this.activeTargetId = targetId;
    this.activeScenarioId = scenarioId;
  }

  public setDemoConfig(targetId: DemoTargetId, scenarioId: DemoScenarioId, speedMultiplier: number = 1.0) {
    this.activeTargetId = targetId;
    this.activeScenarioId = scenarioId;
    this.activeSpeedMultiplier = speedMultiplier;
  }

  public get activeFixture() {
    return DEMO_FIXTURES[this.activeTargetId] ?? ASKBIT_FIXTURE;
  }

  public get sandboxState(): RuntimeSandboxModel | null {
    return this.currentSandbox;
  }

  private resetRevealedState() {
    this.scanState = 'RUNNING';
    this.revealedFindings = [];
    this.revealedTargets = [];
    this.revealedEndpoints = [];
    this.revealedExploits = [];
    this.revealedPatches = [];
    this.currentSandbox = null;
  }

  // Handle incoming stream events to update internal revealed state
  private handleStreamEvent(event: AmassEvent) {
    switch (event.eventType) {
      case 'SCAN_STARTED':
        this.resetRevealedState();
        break;

      case 'SCANNER_STARTED':
        this.revealedFindings = [];
        break;

      case 'SCANNER_FINDING_DISCOVERED': {
        const rawFinding = event.metadata?.finding as FindingModel | undefined;
        if (rawFinding && !this.revealedFindings.some((f) => f.id === rawFinding.id)) {
          this.revealedFindings.push({
            ...rawFinding,
            status: 'DISCOVERED',
            isConfirmed: false,
          });
        }
        break;
      }

      case 'SCANNER_COMPLETED':
        // Global completion event — do not bulk-hydrate findings
        break;

      case 'SANDBOX_PROVISIONING':
        this.currentSandbox = {
          id: (event.metadata?.sandboxId as string) ?? this.activeFixture.sandbox.id,
          sandboxId: (event.metadata?.sandboxId as string) ?? this.activeFixture.sandbox.sandboxId,
          scanId: event.scanId ?? this.activeFixture.scan.scanId,
          status: 'PROVISIONING',
          runtime: (event.metadata?.runtime as string) ?? 'docker-isolated',
          repository: this.activeFixture.sandbox.repository,
          targetUrl: event.metadata?.targetUrl as string | undefined,
          createdAt: event.timestamp,
        };
        break;

      case 'SANDBOX_READY':
        this.currentSandbox = {
          ...this.activeFixture.sandbox,
          status: 'READY',
          createdAt: event.timestamp,
        };
        break;

      case 'SCOUT_ENDPOINT_DISCOVERED': {
        const epPath = (event.metadata?.endpoint || event.metadata?.targetUrl || event.metadata?.url) as string | undefined;
        const findingId = (event.metadata?.findingId as string) || (event.metadata?.vulnerabilityId as string);
        if (epPath) {
          const method = (event.metadata?.method as string) ?? 'GET';
          const matchFixtureEp = this.activeFixture.endpoints.find((e) => e.findingId === findingId || (e.path === epPath && e.method === method));
          const newEp: ScoutEndpoint = matchFixtureEp ?? {
            findingId,
            path: epPath,
            url: epPath,
            method,
            description: event.message,
          };
          if (!this.revealedEndpoints.some((e) => (e.findingId && e.findingId === newEp.findingId) || (e.path === newEp.path && e.method === newEp.method))) {
            this.revealedEndpoints.push(newEp);
          }
        }
        break;
      }

      case 'PLANNER_COMPLETED': {
        const targetMeta = event.metadata?.target as TargetModel | undefined;
        const metaFindingId = event.metadata?.findingId as string | undefined;

        if (targetMeta && !this.revealedTargets.some((t) => t.targetId === targetMeta.targetId)) {
          this.revealedTargets.push(targetMeta);
        }

        const targetIds = this.revealedTargets.map((t) => t.findingId || t.targetId);
        if (metaFindingId && !targetIds.includes(metaFindingId)) {
          targetIds.push(metaFindingId);
        }

        // Mark matching findings as PLANNED
        this.revealedFindings = this.revealedFindings.map((f) => {
          if (targetIds.includes(f.id) || targetIds.includes(f.findingId || '')) {
            return { ...f, status: f.status === 'DISCOVERED' ? 'PLANNED' : f.status };
          }
          return f;
        });
        break;
      }

      case 'SNIPER_TARGET_SELECTED': {
        const targetId = (event.metadata?.findingId as string) || (event.metadata?.targetId as string);
        if (targetId) {
          this.revealedFindings = this.revealedFindings.map((f) => {
            if (f.id === targetId || f.findingId === targetId || f.ruleId === targetId) {
              return { ...f, status: 'VERIFYING' };
            }
            return f;
          });
        }
        break;
      }

      case 'SNIPER_CONFIRMED': {
        const targetId = (event.metadata?.findingId as string) || (event.metadata?.targetId as string) || (event.metadata?.vulnerabilityId as string);
        const ep = event.metadata?.endpoint as string | undefined;

        // Mark matching finding EXPLOIT_CONFIRMED
        this.revealedFindings = this.revealedFindings.map((f) => {
          if (f.id === targetId || f.findingId === targetId || f.ruleId === targetId || (ep && f.endpoint === ep)) {
            return { ...f, status: 'EXPLOIT_CONFIRMED', isConfirmed: true };
          }
          return f;
        });

        // Add exploit evidence
        const matchExp = (event.metadata?.exploit as ExploitEvidenceModel | undefined) ??
          this.activeFixture.exploits.find((e) => e.findingId === targetId || e.targetId === targetId || e.exploitId === `exp-${targetId}`);
        if (matchExp && !this.revealedExploits.some((e) => e.findingId === targetId || e.targetId === targetId)) {
          this.revealedExploits.push({ ...matchExp, confirmed: true });
        }
        break;
      }

      case 'ENGINEER_PATCH_GENERATED': {
        const patchId = event.metadata?.patchId as string | undefined;
        const findingId = event.metadata?.findingId as string | undefined;

        const matchPatch = (event.metadata?.patch as PatchModel | undefined) ??
          this.activeFixture.patches.find((p) => p.patchId === patchId || (findingId && p.findingId === findingId));

        if (matchPatch && !this.revealedPatches.some((p) => p.patchId === matchPatch.patchId)) {
          this.revealedPatches.push(matchPatch);
        }

        // Mark matching finding as PATCHED
        if (findingId) {
          this.revealedFindings = this.revealedFindings.map((f) => {
            if (f.id === findingId || f.findingId === findingId) {
              return { ...f, status: 'PATCHED' };
            }
            return f;
          });
        }
        break;
      }

      case 'CRITIC_APPROVED': {
        const findingId = event.metadata?.findingId as string | undefined;
        if (findingId) {
          this.revealedFindings = this.revealedFindings.map((f) => {
            if (f.id === findingId || f.findingId === findingId) {
              return { ...f, status: 'CRITIC_VERIFIED' };
            }
            return f;
          });
        }
        break;
      }

      case 'CRITIC_REJECTED': {
        const findingId = event.metadata?.findingId as string | undefined;
        if (findingId) {
          this.revealedFindings = this.revealedFindings.map((f) => {
            if (f.id === findingId || f.findingId === findingId) {
              return { ...f, status: 'EXPLOIT_REJECTED' };
            }
            return f;
          });
        }
        break;
      }

      case 'SCAN_COMPLETED':
        this.scanState = 'COMPLETED';
        break;

      case 'SCAN_FAILED':
        this.scanState = 'FAILED';
        break;
    }
  }

  async startScan(options: StartScanOptions): Promise<ApiResponse<ScanModel>> {
    if (options.demoTargetId) this.activeTargetId = options.demoTargetId;
    if (options.scenarioId) this.activeScenarioId = options.scenarioId;
    if (options.speedMultiplier) this.activeSpeedMultiplier = options.speedMultiplier;

    this.stopActiveDemoScan();
    this.resetRevealedState();

    const fixture = this.activeFixture;
    const scanModel: ScanModel = {
      ...fixture.scan,
      startedAt: new Date().toISOString(),
      status: 'RUNNING',
      isDemo: true,
    };

    return {
      success: true,
      data: scanModel,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  async getScan(_scanId: string): Promise<ApiResponse<ScanModel>> {
    return {
      success: true,
      data: {
        ...this.activeFixture.scan,
        status: this.scanState === 'IDLE' ? 'RUNNING' : this.scanState,
        isDemo: true,
      },
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  async getScanResults(_scanId: string): Promise<ApiResponse<{ scanId: string; findings: FindingModel[] }>> {
    return {
      success: true,
      data: {
        scanId: this.activeFixture.scan.scanId,
        findings: this.revealedFindings,
      },
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  async getScanStatistics(_scanId: string): Promise<ApiResponse<ScanStatistics>> {
    const findings = this.revealedFindings;

    const stats: ScanStatistics = {
      totalFindings: findings.length,
      criticalCount: findings.filter((f) => f.severity === 'CRITICAL').length,
      highCount: findings.filter((f) => f.severity === 'HIGH').length,
      mediumCount: findings.filter((f) => f.severity === 'MEDIUM').length,
      lowCount: findings.filter((f) => f.severity === 'LOW').length,
      infoCount: findings.filter((f) => f.severity === 'INFO').length,
    };

    return {
      success: true,
      data: stats,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  async getPlanForScan(_scanId: string): Promise<ApiResponse<PlanModel>> {
    return {
      success: true,
      data: {
        planId: `plan-${this.activeTargetId.toLowerCase()}`,
        scanId: this.activeFixture.scan.scanId,
        status: this.scanState === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
        targets: this.revealedTargets,
      },
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  subscribeEvents(_scanId: string, onEvent: (event: AmassEvent) => void): () => void {
    const wrappedListener = (evt: AmassEvent) => {
      this.handleStreamEvent(evt);
      onEvent(evt);
    };

    this.eventSubscribers.add(wrappedListener);

    // If runner is not active, instantiate and start it
    if (!this.currentRunner) {
      this.resetRevealedState();
      this.currentRunner = new DemoRunner({
        fixture: this.activeFixture,
        scenarioId: this.activeScenarioId,
        speedMultiplier: this.activeSpeedMultiplier,
        onEvent: (evt) => {
          this.eventSubscribers.forEach((sub) => sub(evt));
        },
      });
      this.currentRunner.start();
    }

    return () => {
      this.eventSubscribers.delete(wrappedListener);
    };
  }

  stopActiveDemoScan() {
    if (this.currentRunner) {
      this.currentRunner.stop();
      this.currentRunner = null;
    }
    this.scanState = 'IDLE';
  }
}

export const demoDataProvider = new DemoDataProvider();
