import { logger } from '../../../../config/logger';
import { staticScannerConfig } from '../../../../config';
import type { ScannerRunnerPort } from '../../../domain/ports/scanner-runner';
import type { Scanner, ScannerConfig } from '../../../domain/ports/scanner';
import type { ScanContext, ScannerRunResult } from '../../../domain/models/scan';

/**
 * Orchestrates running a set of scanners against one repository. Each scanner
 * runs in isolation: a failure in one never aborts the others. Logs every run
 * (scanner, duration, status, error, repository).
 */
export class ScannerRunnerService implements ScannerRunnerPort {
  async runAll(scanners: readonly Scanner[], context: ScanContext): Promise<ScannerRunResult[]> {
    const results: ScannerRunResult[] = [];
    for (const scanner of scanners) {
      results.push(await this.runOne(scanner, context));
    }
    return results;
  }

  private async runOne(scanner: Scanner, context: ScanContext): Promise<ScannerRunResult> {
    const startedAt = Date.now();
    try {
      const result = await scanner.run(context, this.configFor(scanner));
      const durationMs = Date.now() - startedAt;
      if (result.status === 'failed') {
        logger.warn(
          { scanner: scanner.id, error: result.error, durationMs, repository: context.repositoryUrl },
          'static_scanner.failed'
        );
      } else {
        logger.info(
          {
            scanner: scanner.id,
            status: result.status,
            durationMs,
            findings: result.findings.length,
            repository: context.repositoryUrl,
          },
          'static_scanner.completed'
        );
      }
      return { ...result, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : 'scanner failed';
      logger.error(
        { scanner: scanner.id, durationMs, error, repository: context.repositoryUrl },
        'static_scanner.errored'
      );
      return {
        scannerId: scanner.id,
        engine: scanner.engine,
        status: 'failed',
        durationMs,
        error: message,
        findings: [],
        rawItems: 0,
      };
    }
  }

  private configFor(scanner: Scanner): ScannerConfig {
    const configs = staticScannerConfig.scanners as unknown as Record<string, { enabled: boolean; timeoutMs?: number; extraArgs: readonly string[] } | undefined>;
    const entry = configs[scanner.id];
    return {
      enabled: entry?.enabled ?? true,
      timeoutMs: entry?.timeoutMs ?? staticScannerConfig.defaultTimeoutMs,
      severityThreshold: staticScannerConfig.severityThreshold,
      extraArgs: entry?.extraArgs ?? [],
    };
  }
}