import path from 'node:path';
import type { RawFinding } from '../../../../domain/models/finding';
import type { ScanTargetProfile } from '../../../../domain/models/scan-target';
import { BaseScanner } from '../base.scanner';

interface BanditResult {
  filename?: string;
  test_id?: string;
  test_name?: string;
  issue_severity?: string;
  issue_confidence?: string;
  issue_text?: string;
  line_number?: number;
  code?: string;
  issue_cwe?: { id?: number; link?: string };
}

interface BanditOutput {
  results?: BanditResult[];
  errors?: unknown[];
}

const CONFIDENCE: Record<string, number> = { HIGH: 0.9, MEDIUM: 0.6, LOW: 0.3 };

/**
 * Bandit — Python source static analysis (semgrep-style rules for Python).
 */
export class BanditScanner extends BaseScanner {
  readonly id = 'bandit';
  readonly engine = 'Bandit';
  readonly metadata = {
    id: 'bandit',
    engine: 'Bandit',
    kind: 'source',
    languages: ['Python'],
    description: 'Bandit: finds common security issues in Python source code',
    networkAccess: false,
  } as const;
  protected readonly defaultConfidence = 0.5;

  isApplicable(profile: ScanTargetProfile): boolean {
    return profile.languages.some((language) => language.toLowerCase() === 'python');
  }

  buildCommand(
    context: Parameters<BaseScanner['buildCommand']>[0],
    config: Parameters<BaseScanner['buildCommand']>[1]
  ) {
    return {
      argv: ['bandit', '-r', context.localPath, '-f', 'json', ...config.extraArgs],
      cwd: context.localPath,
      network: this.metadata.networkAccess,
      timeoutMs: config.timeoutMs,
    };
  }

  parse(output: { stdout: string }): readonly RawFinding[] {
    const parsed = JSON.parse(output.stdout) as BanditOutput;
    const findings: RawFinding[] = [];
    for (const result of parsed.results ?? []) {
      const cweId = result.issue_cwe?.id;
      findings.push({
        type: result.test_name || result.test_id || 'bandit-finding',
        severity: result.issue_severity ?? 'INFO',
        confidence: confidenceOf(result.issue_confidence),
        file: result.filename ?? null,
        line: result.line_number ?? null,
        message: result.issue_text ?? null,
        cwe: cweId ? `CWE-${cweId}` : null,
        cve: null,
        references: result.issue_cwe?.link ? [result.issue_cwe.link] : [],
        evidence: result.code ?? null,
        raw: result,
      });
    }
    return findings;
  }
}

function confidenceOf(value: string | undefined): number | null {
  if (!value) return null;
  return CONFIDENCE[value.toUpperCase()] ?? null;
}