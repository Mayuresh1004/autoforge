import type { ScannerExecutor } from '../../../domain/ports/scanner-executor';
import type {
  Scanner,
  ScannerCommand,
  ScannerConfig,
} from '../../../domain/ports/scanner';
import type { ScanContext, ScannerRunResult } from '../../../domain/models/scan';
import type { ScanTargetProfile } from '../../../domain/models/scan-target';
import type { ScannerMetadata } from '../../../domain/models/scanner-metadata';
import type { RawFinding, UnifiedFinding } from '../../../domain/models/finding';
import { FindingNormalizer } from '../normalizers/normalizer';

/**
 * Base implementation shared by all concrete scanners. Implements `run()`
 * (build → execute → parse → normalize) and `normalize()` (→ UVM) so concrete
 * scanners only declare their metadata, applicability, command and parser.
 */
export abstract class BaseScanner implements Scanner {
  constructor(protected readonly executor: ScannerExecutor) {}

  abstract readonly id: string;
  abstract readonly engine: string;
  abstract readonly metadata: ScannerMetadata;
  /** Used when a tool does not report confidence. */
  protected abstract readonly defaultConfidence: number;

  abstract isApplicable(profile: ScanTargetProfile): boolean;
  abstract buildCommand(context: ScanContext, config: ScannerConfig): ScannerCommand | null;
  abstract parse(output: { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }): readonly RawFinding[];

  normalize(findings: readonly RawFinding[], context: ScanContext): readonly UnifiedFinding[] {
    const normalizer = new FindingNormalizer({
      scannerId: this.id,
      engine: this.engine,
      defaultConfidence: this.defaultConfidence,
      severityThreshold: context.severityThreshold,
    });
    const normalized: UnifiedFinding[] = [];
    for (const finding of findings) {
      const unified = normalizer.normalize(finding, context.scanId);
      if (unified) {
        normalized.push({ ...unified, file: toRelativePath(unified.file, context.localPath) });
      }
    }
    return normalized;
  }

  async run(context: ScanContext, config: ScannerConfig): Promise<ScannerRunResult> {
    const startedAt = Date.now();
    try {
      const command = this.buildCommand(context, config);
      if (command === null) {
        return this.result('skipped', 0, null, [], 0);
      }

      const output = await this.executor.execute(command);
      let raw: readonly RawFinding[] = [];
      try {
        raw = this.parse(output);
      } catch (error) {
        return this.result('failed', Date.now() - startedAt, parseErrorMessage(error), [], 0);
      }

      if (output.timedOut) {
        return this.result('failed', Date.now() - startedAt, 'scanner timed out', [], raw.length);
      }

      const findings = this.normalize(raw, context);
      return this.result('completed', Date.now() - startedAt, null, findings, raw.length);
    } catch (error) {
      return this.result('failed', Date.now() - startedAt, parseErrorMessage(error), [], 0);
    }
  }

  private result(
    status: ScannerRunResult['status'],
    durationMs: number,
    error: string | null,
    findings: readonly UnifiedFinding[],
    rawItems: number
  ): ScannerRunResult {
    return {
      scannerId: this.id,
      engine: this.engine,
      status,
      durationMs,
      error,
      findings,
      rawItems,
    };
  }
}

function parseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'scanner execution failed';
}

/** Strips the absolute working-tree prefix from a tool-emitted path. */
export function toRelativePath(file: string | null, root: string): string | null {
  if (!file) return null;
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedFile = file.replace(/\\/g, '/');
  if (normalizedFile === normalizedRoot) return '.';
  if (normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return normalizedFile.slice(normalizedRoot.length + 1);
  }
  // Paths outside the tree (e.g. node internals) stay as-is but flagged with '.'
  return normalizedFile;
}