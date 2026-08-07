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
import { runScannerFlow } from '../../../static-scanner/application/services/scan-flow';
import type { SandboxScanTarget } from '../../../static-scanner/application/services/repository-target-analyzer';
import { SandboxedScannerExecutor } from '../../infrastructure/pipeline/sandboxed-scanner-executor';
import type { SandboxManager } from '../../domain/ports/sandbox-manager';

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
  }

  async runScan(repositoryUrl: string): Promise<ScanResult> {
    const scanId = `scan_${randomUUID().slice(0, 12)}`;
    logger.info({ scanId, repositoryUrl }, 'sandboxed_scan:started');

    const sandbox = await this.manager.createSandbox({
      scanId,
      type: 'analysis',
      repositoryPath: 'in-sandbox', // the backend materializes its own workspace
      image: this.image,
      egress: 'egress', // allowlisted below; only the clone step may egress
      egressAllowlist: [hostOf(repositoryUrl)],
    });

    let storedScanId: string | undefined;
    try {
      await this.manager.waitUntilReady(sandbox.id, this.createTimeoutMs);

      const workspace = sandbox.workspacePath;
      if (!workspace) {
        throw new Error('sandbox exposes no host-visible workspace (process backend required)');
      }

      const clone = await this.manager.execute(sandbox.id, {
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
      const store = await this.repository.createScan({ name, repositoryUrl });
      storedScanId = store.id;
      const startedAt = new Date();
      await this.repository.markScanRunning(store.id, startedAt);

      const executor = new SandboxedScannerExecutor(this.manager, sandbox.id);
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
          scanId: store.id,
          repositoryUrl,
          repositoryName: name,
          localPath: workspace,
          target,
          startedAt,
        }
      );

      logger.info({ scanId, status: result.status, repositoryUrl }, 'sandboxed_scan:complete');
      return result;
    } catch (error) {
      logger.error({ scanId, error, repositoryUrl }, 'sandboxed_scan:failed');
      if (storedScanId) {
        await this.repository
          .completeScan(storedScanId, { status: 'FAILED', completedAt: new Date(), scannerStats: [] })
          .catch(() => undefined);
      }
      throw error;
    } finally {
      await this.manager.destroy(sandbox.id).catch(() => undefined);
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