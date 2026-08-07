import { createHash } from 'node:crypto';
import type {
  RawFinding,
  UnifiedFinding,
} from '../../../domain/models/finding';
import type { Severity } from '../../../domain/models/severity';
import { isAtOrAbove } from '../../../domain/models/severity';
import { mapSeverity } from './severity-mapper';

export interface NormalizerOptions {
  /** The scanner that produced these findings. */
  readonly scannerId: string;
  readonly engine: string;
  /** Default confidence when the tool gives none. */
  readonly defaultConfidence: number;
  /** Severity threshold; findings below it are dropped. */
  readonly severityThreshold: Severity;
}

/**
 * Converts raw, tool-specific findings into the Unified Vulnerability Model.
 * Deterministic `id` (hashed file/line/type/scanner) and severity mapping live
 * here so every scanner normalizes identically.
 */
export class FindingNormalizer {
  private readonly opts: NormalizerOptions;

  constructor(opts: NormalizerOptions) {
    this.opts = opts;
  }

  normalize(raw: RawFinding, _scanId: string): UnifiedFinding | null {
    const severity = mapSeverity(raw.severity);
    if (!isAtOrAbove(severity, this.opts.severityThreshold)) {
      return null;
    }

    const message = raw.message?.trim() || raw.type || 'No description provided.';
    const createdAt = new Date().toISOString();
    const hash = createHash('sha256')
      .update([raw.file ?? '', String(raw.line ?? ''), raw.type, this.opts.scannerId].join('|'))
      .digest('hex')
      .slice(0, 12);

    return {
      id: `vuln_${hash}`,
      scanner: this.opts.scannerId,
      type: raw.type,
      severity,
      confidence: clampConfidence(raw.confidence ?? this.opts.defaultConfidence),
      file: raw.file,
      line: raw.line,
      message,
      cwe: raw.cwe,
      cve: raw.cve,
      references: unique(raw.references),
      evidence: raw.evidence,
      createdAt,
    };
  }
}

function unique(items: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items ?? []) {
    const trimmed = item.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, value));
}