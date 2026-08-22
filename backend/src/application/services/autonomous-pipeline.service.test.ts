import { describe, it, expect, vi } from 'vitest';
import type { SandboxManager } from '../../sandbox/domain/ports/sandbox-manager';
import type { RuntimeSandboxService } from '../../sandbox/domain/ports/runtime-sandbox-service';
import type { RuntimeSandbox } from '../../sandbox/domain/entities/runtime-sandbox';
import type { ScoutService } from '../../scout/domain/ports/scout-service';
import type { PlannerService } from '../../planner/domain/ports/planner';
import type { SniperService } from '../../sniper/domain/ports/sniper-service';
import type { EngineerService } from '../../engineer/application/services/engineer.service';
import type { CriticService } from '../../critic/application/services/critic.service';
import type { AmassEventPublisher, AmassEventInput } from '../../observability/domain/ports/event-bus';
import { AutonomousPipelineService } from './autonomous-pipeline.service';

describe('AutonomousPipelineService (Incremental Lifecycle)', () => {
  it('executes full autonomous lifecycle from Scanner completion to final SCAN_COMPLETED', async () => {
    const eventsEmitted: AmassEventInput[] = [];
    const eventsPublisher: AmassEventPublisher = {
      publish: (e) => {
        eventsEmitted.push(e);
      },
    };

    const mockManager: SandboxManager = {
      createSandbox: vi.fn(),
      waitUntilReady: vi.fn(),
      getSandbox: vi.fn(),
      updateSandbox: vi.fn(),
      execute: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
      buildImage: vi.fn(),
      removeImage: vi.fn(),
      collectLogs: vi.fn(),
      healthCheck: vi.fn(),
    };

    const mockRuntimeSandbox: RuntimeSandbox = {
      id: 'sbx_test_123',
      scanId: 'scan_test_123',
      status: 'READY',
      sandboxId: 'container_test_123',
      targetUrl: 'http://localhost:8080',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockRuntimeService: RuntimeSandboxService = {
      limits: { maxMemoryMb: 512, maxCpuCores: 1, maxPids: 100 },
      create: vi.fn().mockResolvedValue(mockRuntimeSandbox),
      get: vi.fn().mockResolvedValue(mockRuntimeSandbox),
      healthCheck: vi.fn().mockResolvedValue({ ok: true, status: 'READY', checkedAt: new Date().toISOString() }),
      destroy: vi.fn().mockResolvedValue(mockRuntimeSandbox),
      expire: vi.fn().mockResolvedValue(mockRuntimeSandbox),
      cleanupExpired: vi.fn().mockResolvedValue(0),
    };

    const mockScoutService: ScoutService = {
      run: vi.fn().mockResolvedValue({
        scanId: 'scan_test_123',
        scoutScanId: 'scout_123',
        targetUrl: 'http://localhost:8080',
        status: 'COMPLETED',
        attackSurface: [{ url: '/api/login', method: 'POST', risk: 'HIGH', source: 'crawler', reachable: true }],
        summary: { endpoints: 1, ports: 1, services: 1, forms: 0, adminPanels: 0, graphql: false, websockets: 0, technologies: 1 },
        health: { reachable: true },
        technologies: [],
        ports: [],
        services: [],
        errors: [],
      }),
      getScoutScan: vi.fn(),
      listScoutScans: vi.fn(),
    };

    const mockPlannerService: PlannerService = {
      generate: vi.fn().mockResolvedValue({
        id: 'plan_123',
        scanId: 'scan_test_123',
        createdAt: new Date().toISOString(),
        coveredSurfaces: 1,
        coveredFindings: 1,
        summary: { targets: 1, critical: 0, high: 1, medium: 0, low: 0 },
        targets: [
          {
            targetId: 'target_123',
            endpoint: '/api/login',
            method: 'POST',
            candidateVulnerabilities: ['SQL_INJECTION'],
            priority: 90,
            recommendedTool: 'sqlmap',
            reason: 'High risk endpoint',
            requiresAuthentication: false,
            estimatedRisk: 'HIGH',
            breakdown: [],
          },
        ],
      }),
      plan: vi.fn(),
      getPlan: vi.fn(),
      getPlanForScan: vi.fn(),
    };

    const mockSniperService: SniperService = {
      run: vi.fn().mockResolvedValue({
        runId: 'snip_123',
        scanId: 'scan_test_123',
        sandboxId: 'container_test_123',
        completed: 1,
        total: 1,
        results: [],
      }),
      getExploit: vi.fn(),
      getExploitResults: vi.fn(),
      listExploitsForTarget: vi.fn(),
    };

    const mockEngineerService: EngineerService = {
      run: vi.fn().mockResolvedValue({
        executionId: 'exec_123',
        vulnerabilityId: 'vuln_123',
        patchId: 'patch_123',
        status: 'GENERATED',
        summary: { sourceLines: 50, ragDocs: 2, reviewPassed: true, model: 'test-model', diffChars: 100, reason: null },
      }),
      getRun: vi.fn(),
    };

    const mockCriticService: CriticService = {
      run: vi.fn().mockResolvedValue({
        id: 'critic_run_123',
        patchId: 'patch_123',
        vulnerabilityId: 'vuln_123',
        scanId: 'scan_test_123',
        attempt: 1,
        status: 'APPROVED',
        failureKind: null,
        checks: [],
        exploit: null,
        feedback: null,
        errorMessage: null,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }),
      getRun: vi.fn(),
    };

    const pipeline = new AutonomousPipelineService({
      manager: mockManager,
      runtime: mockRuntimeService,
      scout: mockScoutService,
      planner: mockPlannerService,
      sniper: mockSniperService,
      engineer: mockEngineerService,
      critic: mockCriticService,
      events: eventsPublisher,
    });

    await pipeline.runPipeline({
      scanId: 'scan_test_123',
      repositoryUrl: 'https://github.com/OWASP/NodeGoat.git',
    });

    // 1. Stage 1: Runtime Sandbox Provisioned
    expect(mockRuntimeService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scanId: 'scan_test_123',
        repository: { url: 'https://github.com/OWASP/NodeGoat.git' },
      })
    );

    // 2. Stage 2: Scout Recon Executed
    // Scout is created using bound sandbox or scout service
    expect(mockPlannerService.generate).toHaveBeenCalledWith('scan_test_123');

    // 3. Stage 3 & 4: Sniper Executed with Planned Targets
    expect(mockSniperService.run).toHaveBeenCalledWith({
      scanId: 'scan_test_123',
      sandboxId: 'container_test_123',
      baseUrl: 'http://localhost:8080',
      targetIds: ['target_123'],
    });

    // 4. Final: SCAN_COMPLETED Emitted & Runtime Sandbox Cleaned Up
    const terminalEvent = eventsEmitted.find((e) => e.eventType === 'SCAN_COMPLETED');
    expect(terminalEvent).toBeDefined();
    expect(terminalEvent?.scanId).toBe('scan_test_123');

    expect(mockRuntimeService.destroy).toHaveBeenCalledWith('sbx_test_123');
  });

  it('fails pipeline, emits SCAN_FAILED, skips downstream stages, and cleans up sandbox when Planner fails', async () => {
    const eventsEmitted: AmassEventInput[] = [];
    const eventsPublisher: AmassEventPublisher = {
      publish: (e) => {
        eventsEmitted.push(e);
      },
    };

    const mockRuntimeSandbox: RuntimeSandbox = {
      id: 'sbx_fail_123',
      scanId: 'scan_fail_123',
      status: 'READY',
      sandboxId: 'container_fail_123',
      targetUrl: 'http://localhost:8080',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockRuntimeService: RuntimeSandboxService = {
      limits: { maxMemoryMb: 512, maxCpuCores: 1, maxPids: 100 },
      create: vi.fn().mockResolvedValue(mockRuntimeSandbox),
      get: vi.fn().mockResolvedValue(mockRuntimeSandbox),
      healthCheck: vi.fn().mockResolvedValue({ ok: true, status: 'READY', checkedAt: new Date().toISOString() }),
      destroy: vi.fn().mockResolvedValue(mockRuntimeSandbox),
      expire: vi.fn().mockResolvedValue(mockRuntimeSandbox),
      cleanupExpired: vi.fn().mockResolvedValue(0),
    };

    const mockScoutService: ScoutService = {
      run: vi.fn().mockResolvedValue({
        scanId: 'scan_fail_123',
        scoutScanId: 'scout_123',
        targetUrl: 'http://localhost:8080',
        status: 'COMPLETED',
        attackSurface: [],
        summary: { endpoints: 0, ports: 0, services: 0, forms: 0, adminPanels: 0, graphql: false, websockets: 0, technologies: 0 },
        health: { reachable: true },
        technologies: [],
        ports: [],
        services: [],
        errors: [],
      }),
      getScoutScan: vi.fn(),
      listScoutScans: vi.fn(),
    };

    const mockPlannerService: PlannerService = {
      generate: vi.fn().mockRejectedValue(new Error('Prisma error P2022: The column vulnerabilityId does not exist')),
      plan: vi.fn(),
      getPlan: vi.fn(),
      getPlanForScan: vi.fn(),
    };

    const mockSniperService: SniperService = {
      run: vi.fn(),
      getExploit: vi.fn(),
      getExploitResults: vi.fn(),
      listExploitsForTarget: vi.fn(),
    };

    const mockEngineerService: EngineerService = {
      run: vi.fn(),
      getRun: vi.fn(),
    };

    const mockCriticService: CriticService = {
      run: vi.fn(),
      getRun: vi.fn(),
    };

    const mockPrisma: any = {
      scan: {
        update: vi.fn().mockResolvedValue({ id: 'scan_fail_123', status: 'FAILED' }),
      },
    };

    const pipeline = new AutonomousPipelineService({
      manager: {} as any,
      runtime: mockRuntimeService,
      scout: mockScoutService,
      planner: mockPlannerService,
      sniper: mockSniperService,
      engineer: mockEngineerService,
      critic: mockCriticService,
      events: eventsPublisher,
      prisma: mockPrisma,
    });

    await expect(
      pipeline.runPipeline({
        scanId: 'scan_fail_123',
        repositoryUrl: 'https://github.com/SagarJadhav007/RepoMind.git',
      })
    ).rejects.toThrow('Prisma error P2022');

    // A. Downstream stages not executed
    expect(mockSniperService.run).not.toHaveBeenCalled();
    expect(mockEngineerService.run).not.toHaveBeenCalled();
    expect(mockCriticService.run).not.toHaveBeenCalled();

    // B. SCAN_FAILED event emitted
    const failedEvent = eventsEmitted.find((e) => e.eventType === 'SCAN_FAILED');
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.scanId).toBe('scan_fail_123');
    expect(failedEvent?.status).toBe('FAILED');

    // C. Database scan record marked FAILED
    expect(mockPrisma.scan.update).toHaveBeenCalledWith({
      where: { id: 'scan_fail_123' },
      data: expect.objectContaining({ status: 'FAILED' }),
    });

    // D. Sandbox cleanup still executed
    expect(mockRuntimeService.destroy).toHaveBeenCalledWith('sbx_fail_123');
  });

  it('invokes remediationDelivery.deliver() exactly once when Critic returns APPROVED', async () => {
    const mockRemediationDelivery: any = {
      deliver: vi.fn().mockResolvedValue({ status: 'DELIVERED', prNumber: 42, prUrl: 'https://github.com/org/repo/pull/42' }),
    };

    const mockPrisma: any = {
      exploit: {
        findMany: vi.fn().mockResolvedValue([{ vulnerabilityId: 'vuln_123' }]),
      },
      patch: {
        findMany: vi.fn().mockResolvedValue([{ id: 'patch_123' }]),
      },
      scan: {
        update: vi.fn().mockResolvedValue({ id: 'scan_123', status: 'COMPLETED' }),
      },
    };

    const mockEngineer: any = {
      run: vi.fn().mockResolvedValue({ status: 'GENERATED', patchId: 'patch_123' }),
    };

    const mockCritic: any = {
      run: vi.fn().mockResolvedValue({ status: 'APPROVED' }),
    };

    const pipeline = new AutonomousPipelineService({
      manager: {} as any,
      runtime: { create: vi.fn().mockResolvedValue({ id: 's1', targetUrl: 'http://a' }), destroy: vi.fn().mockResolvedValue({}) } as any,
      scout: { run: vi.fn() } as any,
      planner: { generate: vi.fn().mockResolvedValue({ targets: [{ targetId: 't1' }] }) } as any,
      sniper: { run: vi.fn() } as any,
      engineer: mockEngineer,
      critic: mockCritic,
      remediationDelivery: mockRemediationDelivery,
      prisma: mockPrisma,
    });

    await pipeline.runPipeline({ scanId: 'scan_123', repositoryUrl: 'https://github.com/org/repo.git' });

    expect(mockCritic.run).toHaveBeenCalledWith({ patchId: 'patch_123' });
    expect(mockRemediationDelivery.deliver).toHaveBeenCalledTimes(1);
    expect(mockRemediationDelivery.deliver).toHaveBeenCalledWith({ scanId: 'scan_123', patchId: 'patch_123' });
  });

  it('does NOT invoke remediationDelivery.deliver() when Critic returns REJECTED', async () => {
    const mockRemediationDelivery: any = {
      deliver: vi.fn(),
    };

    const mockPrisma: any = {
      exploit: {
        findMany: vi.fn().mockResolvedValue([{ vulnerabilityId: 'vuln_123' }]),
      },
      patch: {
        findMany: vi.fn().mockResolvedValue([{ id: 'patch_123' }]),
      },
      scan: {
        update: vi.fn().mockResolvedValue({ id: 'scan_123', status: 'COMPLETED' }),
      },
    };

    const mockEngineer: any = {
      run: vi.fn().mockResolvedValue({ status: 'GENERATED', patchId: 'patch_123' }),
    };

    const mockCritic: any = {
      run: vi.fn().mockResolvedValue({ status: 'REJECTED' }),
    };

    const pipeline = new AutonomousPipelineService({
      manager: {} as any,
      runtime: { create: vi.fn().mockResolvedValue({ id: 's1', targetUrl: 'http://a' }), destroy: vi.fn().mockResolvedValue({}) } as any,
      scout: { run: vi.fn() } as any,
      planner: { generate: vi.fn().mockResolvedValue({ targets: [{ targetId: 't1' }] }) } as any,
      sniper: { run: vi.fn() } as any,
      engineer: mockEngineer,
      critic: mockCritic,
      remediationDelivery: mockRemediationDelivery,
      prisma: mockPrisma,
    });

    await pipeline.runPipeline({ scanId: 'scan_123', repositoryUrl: 'https://github.com/org/repo.git' });

    expect(mockCritic.run).toHaveBeenCalledWith({ patchId: 'patch_123' });
    expect(mockRemediationDelivery.deliver).not.toHaveBeenCalled();
  });

  it('fails pipeline, emits SCAN_FAILED, skips Critic/remediation, and cleans up sandbox when Engineer fails', async () => {
    const eventsEmitted: AmassEventInput[] = [];
    const eventsPublisher: AmassEventPublisher = {
      publish: (e) => {
        eventsEmitted.push(e);
      },
    };

    const mockRuntimeSandbox: RuntimeSandbox = {
      id: 'sbx_eng_fail_123',
      scanId: 'scan_eng_fail_123',
      status: 'READY',
      sandboxId: 'container_eng_fail_123',
      targetUrl: 'http://localhost:8080',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockRuntimeService: RuntimeSandboxService = {
      limits: { maxMemoryMb: 512, maxCpuCores: 1, maxPids: 100 },
      create: vi.fn().mockResolvedValue(mockRuntimeSandbox),
      get: vi.fn().mockResolvedValue(mockRuntimeSandbox),
      healthCheck: vi.fn().mockResolvedValue({ ok: true, status: 'READY', checkedAt: new Date().toISOString() }),
      destroy: vi.fn().mockResolvedValue(mockRuntimeSandbox),
      expire: vi.fn().mockResolvedValue(mockRuntimeSandbox),
      cleanupExpired: vi.fn().mockResolvedValue(0),
    };

    const mockEngineerService: EngineerService = {
      run: vi.fn().mockRejectedValue(new Error('model response failed structural validation')),
      getRun: vi.fn(),
    };

    const mockCriticService: CriticService = {
      run: vi.fn(),
      getRun: vi.fn(),
    };

    const mockPrisma: any = {
      exploit: {
        findMany: vi.fn().mockResolvedValue([{ vulnerabilityId: 'vuln_123' }]),
      },
      scan: {
        update: vi.fn().mockResolvedValue({ id: 'scan_eng_fail_123', status: 'FAILED' }),
      },
    };

    const pipeline = new AutonomousPipelineService({
      manager: {} as any,
      runtime: mockRuntimeService,
      scout: { run: vi.fn() } as any,
      planner: { generate: vi.fn().mockResolvedValue({ targets: [{ targetId: 't1' }] }) } as any,
      sniper: { run: vi.fn() } as any,
      engineer: mockEngineerService,
      critic: mockCriticService,
      events: eventsPublisher,
      prisma: mockPrisma,
    });

    await expect(
      pipeline.runPipeline({
        scanId: 'scan_eng_fail_123',
        repositoryUrl: 'https://github.com/org/repo.git',
      })
    ).rejects.toThrow('model response failed structural validation');

    expect(mockCriticService.run).not.toHaveBeenCalled();

    const failedEvent = eventsEmitted.find((e) => e.eventType === 'SCAN_FAILED');
    expect(failedEvent).toBeDefined();

    expect(mockPrisma.scan.update).toHaveBeenCalledWith({
      where: { id: 'scan_eng_fail_123' },
      data: expect.objectContaining({ status: 'FAILED' }),
    });

    expect(mockRuntimeService.destroy).toHaveBeenCalledWith('sbx_eng_fail_123');
  });
});
