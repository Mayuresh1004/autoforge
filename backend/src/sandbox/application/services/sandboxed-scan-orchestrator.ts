import { randomUUID } from 'node:crypto';
import { logger } from '../../../config/logger';
import type { Severity } from '../../../static-scanner/domain/models/severity';
import type { ScanResult } from '../../../static-scanner/domain/models/scan';
import type { ScannerExecutor } from '../../../static-scanner/domain/ports/scanner-executor';
import type { ScannerRegistry } from '../../../static-scanner/domain/ports/scanner-registry';
import type { ScannerRunnerPort } from '../../../static-scanner/domain/ports/scanner-runner';
import type { FindingDeduplicator } from '../../../static-scanner/domain/ports/deduplicator';
import type { ScanRepository } from '../../../static-scanner/domain/ports/scan-repository';
import { createDefaultScannerRegistry } from '../../../static-scanner/infrastructure/scanning/factory/scanner-factory';
import { nameFromUrl, runScannerFlow } from '../../../static-scanner/application/services/scan-flow';
import type { SandboxScanTarget } from '../../../static-scanner/application/services/repository-target-analyzer';
import { SandboxedScannerExecutor } from '../../infrastructure/pipeline/sandboxed-scanner-executor';
import type { SandboxManager } from '../../domain/ports/sandbox-manager';
import type { AmassEventPublisher, AmassEventInput } from '../../../observability/domain/ports/event-bus';
import { DeferredEventPublisher } from '../../../observability/application/deferred-publisher';

export interface SandboxedScanOrchestratorOptions {
  /** The manager — the only component that knows how to build/run sandboxes. */
  readonly manager: SandboxManager;
  /** Analyze the already-cloned sandbox tree into a small scanner profile. */
  readonly analyzeTarget: (localPath: string, repositoryUrl: string) => Promise<SandboxScanTarget>;
  /** Builds the scanner suite bound to a given executor (default: built-ins). */
  readonly registryFactory?: (executor: ScannerExecutor) => ScannerRegistry;
  readonly runner: ScannerRunnerPort;
  readonly deduplicator: FindingDeduplicator;
  readonly repository: ScanRepository;
  readonly severityThreshold: Severity;
  readonly image?: string;
  readonly createTimeoutMs?: number;
  readonly cloneTimeoutMs?: number;
  /** Phase 9 observability publisher (default: silent). */
  readonly events?: AmassEventPublisher;
  /** Autonomous pipeline runner for downstream stages. */
  readonly pipelineRunner?: { runPipeline(options: { scanId: string; repositoryUrl: string }): Promise<void> };
}

/**
 * The whole clone → analyze → scan pipeline inside ONE manager-owned,
 * ephemeral analysis sandbox:
 *
 *   1. create an analysis sandbox (egress allowed only via the repo-host
 *      allowlist, needed for the clone step),
 *   2. `git clone` via `manager.execute` with per-call egress,
 *   3. analyze the sandboxed tree (trusted code reads files; nothing from
 *      the repo is executed),
 *   4. run every scanner through `manager.execute` with network 'none',
 *   5. destroy the sandbox (reaper as backstop).
 *
 * No component here talks to Docker/child_process directly — everything is a
 * typed `SandboxManager` operation.
 */
export class SandboxedScanOrchestrator {
  private readonly manager: SandboxManager;
  private readonly analyzeTarget: (localPath: string, repositoryUrl: string) => Promise<SandboxScanTarget>;
  private readonly registryFactory: (executor: ScannerExecutor) => ScannerRegistry;
  private readonly runner: ScannerRunnerPort;
  private readonly deduplicator: FindingDeduplicator;
  private readonly repository: ScanRepository;
  private readonly severityThreshold: Severity;
  private readonly image: string;
  private readonly createTimeoutMs: number;
  private readonly cloneTimeoutMs: number;
  private readonly events: AmassEventPublisher | undefined;
  private readonly pipelineRunner?: { runPipeline(options: { scanId: string; repositoryUrl: string }): Promise<void> };

  constructor(options: SandboxedScanOrchestratorOptions) {
    this.manager = options.manager;
    this.analyzeTarget = options.analyzeTarget;
    this.registryFactory = options.registryFactory ?? createDefaultScannerRegistry;
    this.runner = options.runner;
    this.deduplicator = options.deduplicator;
    this.repository = options.repository;
    this.severityThreshold = options.severityThreshold;
    this.image = options.image ?? 'amass/analysis:local';
    this.createTimeoutMs = options.createTimeoutMs ?? 120_000;
    this.cloneTimeoutMs = options.cloneTimeoutMs ?? 60_000;
    this.events = options.events;
    this.pipelineRunner = options.pipelineRunner;
  }

  async startScan(repositoryUrl: string): Promise<{ scanId: string; status: string }> {
    const name = nameFromUrl(repositoryUrl);
    const store = await this.repository.createScan({ name, repositoryUrl });
    const scanId = store.id;

    logger.info({ scanId, repositoryUrl }, 'SCAN_CREATED');
    logger.info({ scanId, repositoryUrl }, 'SCAN_BACKGROUND_STARTED');

    void this.executePipelineInBackground(scanId, repositoryUrl).catch((error) => {
      logger.error({ scanId, error, repositoryUrl }, 'SCAN_BACKGROUND_UNHANDLED_ERROR');
    });

    return { scanId, status: 'RUNNING' };
  }

  async runScan(repositoryUrl: string): Promise<ScanResult> {
    const name = nameFromUrl(repositoryUrl);
    const store = await this.repository.createScan({ name, repositoryUrl });
    const scanId = store.id;

    logger.info({ scanId, repositoryUrl }, 'SCAN_CREATED');
    logger.info({ scanId, repositoryUrl }, 'SCAN_BACKGROUND_STARTED');

    return this.executePipelineInBackground(scanId, repositoryUrl);
  }

  private async executePipelineInBackground(scanId: string, repositoryUrl: string): Promise<ScanResult> {
    logger.info({ scanId, repositoryUrl }, 'sandboxed_scan:started');

    const deferred = new DeferredEventPublisher(this.events);
    deferred.emit({ eventType: 'ANALYZER_STARTED', agentType: 'ANALYZER', phase: 'analysis', status: 'STARTED', message: 'cloning and analyzing the repository inside an analysis sandbox', metadata: { targetUrl: repositoryUrl } });
    deferred.emit({ eventType: 'SANDBOX_PROVISIONING', agentType: 'SANDBOX', phase: 'sandbox', status: 'STARTED', message: 'provisioning analysis sandbox', metadata: { runtime: 'manager' } });

    this.emit(scanId, { eventType: 'SCAN_STARTED', agentType: 'SYSTEM', phase: 'scan', status: 'STARTED', message: `scan ${scanId} started`, metadata: { targetUrl: repositoryUrl } });
    deferred.flush(scanId);
    const startedAt = new Date();
    await this.repository.markScanRunning(scanId, startedAt);

    let activeSandbox: { id: string; workspacePath?: string | null } | null = null;
    try {
      const createdSandbox = await this.manager.createSandbox({
        scanId,
        type: 'analysis',
        repositoryPath: 'in-sandbox', // the backend materializes its own workspace
        image: this.image,
        egress: 'egress', // allowlisted below; only the clone step may egress
        egressAllowlist: [hostOf(repositoryUrl)],
      });
      activeSandbox = createdSandbox;

      await this.manager.waitUntilReady(createdSandbox.id, this.createTimeoutMs);
      this.emit(scanId, { eventType: 'SANDBOX_READY', agentType: 'SANDBOX', phase: 'sandbox', status: 'READY', message: `analysis sandbox ${createdSandbox.id} ready`, metadata: { sandboxId: createdSandbox.id } });

      const workspace = createdSandbox.workspacePath;
      if (!workspace) {
        throw new Error('sandbox exposes no host-visible workspace (process backend required)');
      }

      const clone = await this.manager.execute(createdSandbox.id, {
        argv: ['git', 'clone', '--depth', '1', repositoryUrl, '.'],
        cwd: workspace,
        timeoutMs: this.cloneTimeoutMs,
        envAllowlist: ['PATH', 'HOME', 'TMPDIR'],
        envOverrides: { GIT_TERMINAL_PROMPT: '0' },
        network: 'egress', // the one sanctioned egress call of the scan
      });
      if (clone.exitCode !== 0) {
        throw new Error(`git clone failed (${clone.exitCode}): ${truncate(clone.stderr)}`);
      }

      const { name, target } = await this.analyzeTarget(workspace, repositoryUrl);
      this.emit(scanId, { eventType: 'ANALYZER_COMPLETED', agentType: 'ANALYZER', phase: 'analysis', status: 'COMPLETED', message: 'sandboxed repository analysis finished', metadata: { counts: { languages: target.languages.length } } });

      this.emit(scanId, { eventType: 'SCANNER_STARTED', agentType: 'SCANNER', phase: 'scanning', status: 'STARTED', message: 'running the selected scanners in the sandbox', metadata: {} });

      const executor = new SandboxedScannerExecutor(this.manager, createdSandbox.id);
      const registry = this.registryFactory(executor);
      const result = await runScannerFlow(
        {
          registry,
          runner: this.runner,
          deduplicator: this.deduplicator,
          repository: this.repository,
          severityThreshold: this.severityThreshold,
        },
        {
          scanId,
          repositoryUrl,
          repositoryName: name,
          localPath: workspace,
          target,
          startedAt,
        }
      );

      this.emit(scanId, { eventType: 'SCANNER_COMPLETED', agentType: 'SCANNER', phase: 'scanning', status: 'COMPLETED', message: `scanners finished with ${result.findings.length} findings`, metadata: { counts: { findings: result.findings.length, scanners: result.scannerStatistics.length } } });

      if (this.pipelineRunner) {
        await this.pipelineRunner.runPipeline({ scanId, repositoryUrl });
      } else {
        this.emit(scanId, { eventType: 'SCAN_COMPLETED', agentType: 'SYSTEM', phase: 'scan', status: 'COMPLETED', message: `scan ${scanId} completed`, metadata: { counts: { findings: result.findings.length } } });
      }

      logger.info({ scanId, status: result.status, repositoryUrl }, 'SCAN_BACKGROUND_COMPLETED');
      return result;
    } catch (error) {
      const e = error as any;
      logger.error(
        {
          scanId,
          repositoryUrl,
          err: {
            name: e?.name,
            message: e?.message,
            stack: e?.stack,
            code: e?.code,
            cause: e?.cause,
            stderr: e?.stderr,
            stdout: e?.stdout,
          },
        },
        'SCAN_BACKGROUND_FAILED'
      );
      this.emit(scanId, { eventType: 'SCAN_FAILED', agentType: 'SYSTEM', phase: 'scan', level: 'ERROR', status: 'FAILED', message: 'scan failed', metadata: { error: error instanceof Error ? error.message.slice(0, 160) : undefined } });
      await this.repository
        .completeScan(scanId, { status: 'FAILED', completedAt: new Date(), scannerStats: [] })
        .catch(() => undefined);
      throw error;
    } finally {
      if (activeSandbox) {
        this.emit(scanId, { eventType: 'SANDBOX_DESTROYED', agentType: 'SANDBOX', phase: 'sandbox', status: 'DESTROYED', message: `analysis sandbox ${activeSandbox.id} destroyed`, metadata: { sandboxId: activeSandbox.id } });
        await this.manager.destroy(activeSandbox.id).catch(() => undefined);
      }
    }
  }

  private emit(scanId: string, input: Omit<AmassEventInput, 'scanId'>): void {
    if (!this.events || !scanId) return;
    try {
      this.events.publish({ ...input, scanId });
    } catch (error) {
      logger.warn({ err: error }, 'sandboxed_scan.events: publish ignored');
    }
  }
}

function hostOf(repositoryUrl: string): string {
  try {
    return new URL(repositoryUrl).hostname || 'localhost';
  } catch {
    return 'localhost';
  }
}

function truncate(text: string, max = 2_000): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}