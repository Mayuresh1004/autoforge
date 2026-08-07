import type { RawFinding } from '../../../../domain/models/finding';
import type { ScanTargetProfile } from '../../../../domain/models/scan-target';
import { BaseScanner } from '../base.scanner';

interface NpmVia {
  title?: string;
  url?: string;
  severity?: string;
  range?: string;
}

interface NpmPackageVuln {
  name?: string;
  severity?: string;
  range?: string;
  via?: Array<string | NpmVia>;
}

interface NpmAuditOutput {
  vulnerabilities?: Record<string, NpmPackageVuln>;
}

/**
 * npm audit — audits the JavaScript dependency tree against the npm
 * advisory database. Reports supply-chain issues, not source issues. Note:
 * `npm audit` exits non-zero when vulnerabilities are found; the parsed JSON
 * is still valid, so non-zero codes are intentionally not treated as failures.
 */
export class NpmAuditScanner extends BaseScanner {
  readonly id = 'npm-audit';
  readonly engine = 'npm audit';
  readonly metadata = {
    id: 'npm-audit',
    engine: 'npm audit',
    kind: 'dependency',
    languages: ['JavaScript', 'TypeScript'],
    description: 'npm audit: audits the JavaScript dependency tree against the advisory registry',
    networkAccess: true,
  } as const;
  protected readonly defaultConfidence = 0.9;

  isApplicable(profile: ScanTargetProfile): boolean {
    return profile.ecosystems.some((ecosystem) => ecosystem === 'npm');
  }

  buildCommand(
    context: Parameters<BaseScanner['buildCommand']>[0],
    config: Parameters<BaseScanner['buildCommand']>[1]
  ) {
    return {
      argv: ['npm', 'audit', '--json', ...config.extraArgs],
      cwd: context.localPath,
      network: this.metadata.networkAccess,
      timeoutMs: config.timeoutMs,
    };
  }

  parse(output: { stdout: string }): readonly RawFinding[] {
    const parsed = JSON.parse(output.stdout) as NpmAuditOutput;
    const findings: RawFinding[] = [];
    for (const pkg of Object.values(parsed.vulnerabilities ?? {})) {
      const targetedRange = pkg.range ?? 'unknown';
      for (const via of pkg.via ?? []) {
        if (typeof via === 'string') {
          findings.push({
            type: via,
            severity: pkg.severity ?? 'INFO',
            confidence: null,
            file: null,
            line: null,
            message: `${pkg.name ?? 'package'}: ${via}`,
            cwe: null,
            cve: null,
            references: [],
            evidence: `${pkg.name}@${targetedRange}`,
            raw: pkg,
          });
          continue;
        }
        const advisory = via as NpmVia;
        findings.push({
          type: advisory.title ?? 'npm-advisory',
          severity: advisory.severity ?? pkg.severity ?? 'INFO',
          confidence: null,
          file: null,
          line: null,
          message: `${pkg.name ?? 'package'}: ${advisory.title ?? 'vulnerable dependency'}`,
          cwe: null,
          cve: null,
          references: advisory.url ? [advisory.url] : [],
          evidence: `${pkg.name}@${advisory.range ?? targetedRange}`,
          raw: via,
        });
      }
    }
    return findings;
  }
}