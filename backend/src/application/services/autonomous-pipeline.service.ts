import type { PrismaClient } from '@prisma/client';
import { logger } from '../../config/logger';
import type { SandboxManager } from '../../sandbox/domain/ports/sandbox-manager';
import type { RuntimeSandboxService } from '../../sandbox/domain/ports/runtime-sandbox-service';
import type { RuntimeSandbox } from '../../sandbox/domain/entities/runtime-sandbox';
import type { ScoutService } from '../../scout/domain/ports/scout-service';
import { createSandboxBoundScoutService, createScoutService } from '../../scout/infrastructure/factory/scout-factory';
import type { PlannerService } from '../../planner/domain/ports/planner';
import type { SniperService } from '../../sniper/domain/ports/sniper-service';
import type { EngineerService } from '../../engineer/application/services/engineer.service';
import type { CriticService } from '../../critic/application/services/critic.service';
import type { RemediationDeliveryService } from '../../remediation/application/services/remediation-delivery.service';
import type { AmassEventPublisher, AmassEventInput } from '../../observability/domain/ports/event-bus';

export interface AutonomousPipelineDeps {
  readonly manager: SandboxManager;
  readonly runtime: RuntimeSandboxService;
  readonly scout?: ScoutService;
  readonly planner: PlannerService;
  readonly sniper: SniperService;
  readonly engineer: EngineerService;
  readonly critic: CriticService;
  readonly remediationDelivery?: RemediationDeliveryService;
  readonly events?: AmassEventPublisher;
  readonly prisma?: PrismaClient;
}

export interface RunPipelineOptions {
  readonly scanId: string;
  readonly repositoryUrl: string;
}

export class AutonomousPipelineService {
  constructor(private readonly deps: AutonomousPipelineDeps) {}

  async runPipeline(options: RunPipelineOptions): Promise<void> {
    const { scanId, repositoryUrl } = options;
    logger.info({ scanId, repositoryUrl }, 'autonomous_pipeline:started');

    let runtimeSandbox: RuntimeSandbox | null = null;
    try {
      // 1. Scanner -> Runtime Sandbox
      runtimeSandbox = await this.provisionRuntimeSandbox(scanId, repositoryUrl);

      // 2. Runtime Sandbox -> Scout
      await this.runScoutStage(scanId, runtimeSandbox);

      // 3. Scout -> Planner
      const plan = await this.runPlannerStage(scanId);

      // 4. Planner -> Sniper
      await this.runSniperStage(scanId, runtimeSandbox, plan?.targets.map((t) => t.targetId) ?? []);

      // 5. Sniper -> Engineer
      await this.runEngineerStage(scanId);

      // 6. Engineer -> Critic
      await this.runCriticStage(scanId);

      // 7. Terminal SCAN_COMPLETED
      this.emit(scanId, {
        eventType: 'SCAN_COMPLETED',
        agentType: 'SYSTEM',
        phase: 'scan',
        status: 'COMPLETED',
        message: `scan ${scanId} completed`,
        metadata: { scanId },
      });

      if (this.deps.prisma) {
        await this.deps.prisma.scan.update({
          where: { id: scanId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        }).catch(() => undefined);
      }

      logger.info({ scanId }, 'autonomous_pipeline:completed');
    } catch (error) {
      logger.error({ scanId, error }, 'autonomous_pipeline:failed');
      this.emit(scanId, {
        eventType: 'SCAN_FAILED',
        agentType: 'SYSTEM',
        phase: 'scan',
        level: 'ERROR',
        status: 'FAILED',
        message: `autonomous pipeline failed: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      if (this.deps.prisma) {
        await this.deps.prisma.scan.update({
          where: { id: scanId },
          data: { status: 'FAILED', completedAt: new Date() },
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      if (repositoryUrl.toLowerCase().includes('nodegoat')) {
        try {
          const { execFileSync } = await import('node:child_process');
          execFileSync('docker', ['rm', '-f', `amass-mongo-${scanId}`], { stdio: 'pipe' });
        } catch {}
      }
      if (runtimeSandbox) {
        await this.deps.runtime.destroy(runtimeSandbox.id).catch((err) => {
          logger.warn({ scanId, err, sandboxId: runtimeSandbox?.id }, 'autonomous_pipeline:runtime_sandbox_cleanup_failed');
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Stage 1: Runtime Sandbox Provisioning
  // -------------------------------------------------------------------------
  private async provisionRuntimeSandbox(scanId: string, repositoryUrl: string): Promise<RuntimeSandbox> {
    logger.info({ scanId, repositoryUrl }, 'autonomous_pipeline:stage1_runtime_sandbox:start');
    
    let env: Record<string, string> | undefined;
    if (repositoryUrl.toLowerCase().includes('nodegoat')) {
      const networkId = `amass-net-${scanId}`;
      const mongoName = `amass-mongo-${scanId}`;
      try {
        const { execFileSync } = await import('node:child_process');
        execFileSync('docker', ['network', 'create', '--label', 'amass.manager=1', '--label', `amass.scan=${scanId}`, '--internal', networkId], { stdio: 'pipe' });
        execFileSync('docker', ['run', '-d', '--rm', '--name', mongoName, '--network', networkId, '--label', 'amass.manager=1', 'mongo:4.4'], { stdio: 'pipe' });
        env = { MONGODB_URI: `mongodb://${mongoName}:27017/nodegoat` };
        logger.info({ scanId, mongoName, networkId }, 'autonomous_pipeline:mongo_sibling_provisioned');
      } catch (err) {
        logger.warn({ scanId, err }, 'autonomous_pipeline:mongo_sibling_setup_failed');
      }
    }

    const sandbox = await this.deps.runtime.create({
      scanId,
      repository: { url: repositoryUrl },
      env,
    });
    logger.info({ scanId, sandboxId: sandbox.id, targetUrl: sandbox.targetUrl }, 'autonomous_pipeline:stage1_runtime_sandbox:ready');
    return sandbox;
  }

  // -------------------------------------------------------------------------
  // Stage 2: Scout Recon
  // -------------------------------------------------------------------------
  private async runScoutStage(scanId: string, sandbox: RuntimeSandbox): Promise<void> {
    const targetUrl = sandbox.targetUrl;
    if (!targetUrl) {
      logger.warn({ scanId }, 'autonomous_pipeline:stage2_scout:skipped_no_target_url');
      return;
    }
    logger.info({ scanId, targetUrl }, 'autonomous_pipeline:stage2_scout:start');
    const scoutService = this.deps.scout
      ? this.deps.scout
      : sandbox.sandboxId
        ? createSandboxBoundScoutService(sandbox.sandboxId, this.deps.manager, { events: this.deps.events })
        : createScoutService({ events: this.deps.events });

    try {
      await scoutService.run({ scanId, targetUrl });
      logger.info({ scanId }, 'autonomous_pipeline:stage2_scout:completed');
    } catch (err) {
      logger.error({ scanId, err }, 'autonomous_pipeline:stage2_scout:error');
    }
  }

  // -------------------------------------------------------------------------
  // Stage 3: Attack Planner
  // -------------------------------------------------------------------------
  private async runPlannerStage(scanId: string) {
    logger.info({ scanId }, 'autonomous_pipeline:stage3_planner:start');
    try {
      const plan = await this.deps.planner.generate(scanId);
      logger.info({ scanId, targetCount: plan.targets.length }, 'autonomous_pipeline:stage3_planner:completed');
      return plan;
    } catch (err) {
      logger.error({ scanId, err }, 'autonomous_pipeline:stage3_planner:error');
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Stage 4: Sniper Exploit Verifier
  // -------------------------------------------------------------------------
  private async runSniperStage(scanId: string, sandbox: RuntimeSandbox, targetIds: string[]): Promise<void> {
    if (!sandbox.sandboxId || !sandbox.targetUrl || targetIds.length === 0) {
      logger.info(
        { scanId, hasSandboxId: Boolean(sandbox.sandboxId), hasTargetUrl: Boolean(sandbox.targetUrl), targetCount: targetIds.length },
        'autonomous_pipeline:stage4_sniper:skipped'
      );
      return;
    }
    logger.info({ scanId, sandboxId: sandbox.sandboxId, baseUrl: sandbox.targetUrl, targetIds }, 'autonomous_pipeline:stage4_sniper:start');
    try {
      await this.deps.sniper.run({
        scanId,
        sandboxId: sandbox.sandboxId,
        baseUrl: sandbox.targetUrl,
        targetIds,
      });
      logger.info({ scanId }, 'autonomous_pipeline:stage4_sniper:completed');
    } catch (err) {
      logger.error({ scanId, err }, 'autonomous_pipeline:stage4_sniper:error');
    }
  }

  // -------------------------------------------------------------------------
  // Stage 5: Engineer Patch Generation
  // -------------------------------------------------------------------------
  private async runEngineerStage(scanId: string): Promise<void> {
    logger.info({ scanId }, 'autonomous_pipeline:stage5_engineer:start');
    if (!this.deps.prisma) {
      logger.warn({ scanId }, 'autonomous_pipeline:stage5_engineer:skipped_no_prisma');
      return;
    }

    try {
      // Find vulnerabilities that have confirmed exploits
      const confirmedExploits = await this.deps.prisma.exploit.findMany({
        where: { scanId, status: 'CONFIRMED' },
        select: { vulnerabilityId: true },
      });

      const confirmedVulnIds = Array.from(
        new Set(confirmedExploits.map((e) => e.vulnerabilityId).filter((id): id is string => Boolean(id)))
      );

      if (confirmedVulnIds.length === 0) {
        logger.info({ scanId }, 'autonomous_pipeline:stage5_engineer:no_confirmed_vulnerabilities');
        return;
      }

      for (const vulnId of confirmedVulnIds) {
        try {
          await this.deps.engineer.run({ scanId, vulnerabilityId: vulnId });
        } catch (err) {
          logger.error({ scanId, vulnId, err }, 'autonomous_pipeline:stage5_engineer:vulnerability_error');
        }
      }
      logger.info({ scanId, count: confirmedVulnIds.length }, 'autonomous_pipeline:stage5_engineer:completed');
    } catch (err) {
      logger.error({ scanId, err }, 'autonomous_pipeline:stage5_engineer:error');
    }
  }

  // -------------------------------------------------------------------------
  // Stage 6: Critic Patch Validation
  // -------------------------------------------------------------------------
  private async runCriticStage(scanId: string): Promise<void> {
    logger.info({ scanId }, 'autonomous_pipeline:stage6_critic:start');
    if (!this.deps.prisma) {
      logger.warn({ scanId }, 'autonomous_pipeline:stage6_critic:skipped_no_prisma');
      return;
    }

    try {
      // Find generated patches for vulnerabilities belonging to this scan
      const generatedPatches = await this.deps.prisma.patch.findMany({
        where: {
          status: 'GENERATED',
          vulnerability: { scanId },
        },
        select: { id: true },
      });

      if (generatedPatches.length === 0) {
        logger.info({ scanId }, 'autonomous_pipeline:stage6_critic:no_generated_patches');
        return;
      }

      for (const patch of generatedPatches) {
        try {
          const criticRun = await this.deps.critic.run({ patchId: patch.id });
          if (criticRun.status === 'APPROVED') {
            logger.info({ scanId, patchId: patch.id, criticStatus: criticRun.status }, 'remediation_delivery:triggered');
            if (this.deps.remediationDelivery) {
              try {
                await this.deps.remediationDelivery.deliver({ scanId, patchId: patch.id });
              } catch (deliveryErr) {
                logger.error({ scanId, patchId: patch.id, err: deliveryErr }, 'remediation_delivery:failed');
              }
            } else {
              logger.warn({ scanId, patchId: patch.id }, 'remediation_delivery:skipped_no_service');
            }
          }
        } catch (err) {
          logger.error({ scanId, patchId: patch.id, err }, 'autonomous_pipeline:stage6_critic:patch_error');
        }
      }
      logger.info({ scanId, count: generatedPatches.length }, 'autonomous_pipeline:stage6_critic:completed');
    } catch (err) {
      logger.error({ scanId, err }, 'autonomous_pipeline:stage6_critic:error');
    }
  }

  private emit(scanId: string, input: Omit<AmassEventInput, 'scanId'>): void {
    if (!this.deps.events) return;
    try {
      this.deps.events.publish({ ...input, scanId });
    } catch (error) {
      logger.warn({ err: error }, 'autonomous_pipeline.events: publish ignored');
    }
  }
}
