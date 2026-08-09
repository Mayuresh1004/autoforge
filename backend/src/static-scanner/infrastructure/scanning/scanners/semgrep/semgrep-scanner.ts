import type { RawFinding } from '../../../../domain/models/finding';
import type { ScanTargetProfile } from '../../../../domain/models/scan-target';
import { BaseScanner } from '../base.scanner';

interface SemgrepExtra {
  message?: string;
  severity?: string;
  metadata?: { cwe?: string[]; references?: string[] };
  lines?: string;
}

interface SemgrepResult {
  check_id?: string;
  path?: string;
  start?: { line?: number; col?: number };
  end?: { line?: number; col?: number };
  extra?: SemgrepExtra;
}

interface SemgrepOutput {
  results?: SemgrepResult[];
  errors?: unknown[];
}

/**
 * Semgrep — pattern-based source static analysis. Here used for the
 * JavaScript / TypeScript surface (Node projects).
 */
export class SemgrepScanner extends BaseScanner {
  readonly id = 'semgrep';
  readonly engine = 'Semgrep';
  readonly metadata = {
    id: 'semgrep',
    engine: 'Semgrep',
    kind: 'source',
    languages: ['JavaScript', 'TypeScript'],
    description: 'Semgrep: fast pattern-based source code analysis',
    networkAccess: false,
  } as const;
  protected readonly defaultConfidence = 0.6;

  isApplicable(profile: ScanTargetProfile): boolean {
    return profile.languages.some((language) =>
      ['javascript', 'typescript'].includes(language.toLowerCase())
    );
  }

  buildCommand(
    context: Parameters<BaseScanner['buildCommand']>[0],
    config: Parameters<BaseScanner['buildCommand']>[1]
  ) {
    return {
      argv: ['semgrep', 'scan', '--json', '--quiet', context.localPath, ...config.extraArgs],
      cwd: context.localPath,
      network: this.metadata.networkAccess,
      timeoutMs: config.timeoutMs,
    };
  }

  parse(output: { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }): readonly RawFinding[] {
    if (!output.stdout.trim()) {
      return [];
    }
    const parsed = JSON.parse(output.stdout) as SemgrepOutput;
    const findings: RawFinding[] = [];
    for (const result of parsed.results ?? []) {
      const extra = result.extra ?? {};
      findings.push({
        type: result.check_id ?? 'semgrep-finding',
        severity: extra.severity ?? 'INFO',
        confidence: null,
        file: result.path ?? null,
        line: result.start?.line ?? null,
        message: extra.message ?? null,
        cwe: extra.metadata?.cwe?.[0] ?? null,
        cve: null,
        references: extra.metadata?.references ?? [],
        evidence: extra.lines ?? null,
        raw: result,
      });
    }
    return findings;
  }
}