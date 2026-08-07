import path from 'node:path';
import type { RawFinding } from '../../../../domain/models/finding';
import type { ScanTargetProfile } from '../../../../domain/models/scan-target';
import { BaseScanner } from '../base.scanner';

interface PipAuditAdvisory {
  id?: string;
  aliases?: string[];
  summary?: string;
  severity?: string;
  links?: string[];
}

interface PipAuditVuln {
  id?: string;
  advisory?: PipAuditAdvisory;
}

interface PipAuditDependency {
  name?: string;
  version?: string;
  vulns?: PipAuditVuln[];
}

interface PipAuditOutput {
  dependencies?: PipAuditDependency[];
}

/**
 * pip-audit — audits Python dependencies (requirements.txt) against the OSV
 * database. Reports supply-chain (CVE/GHSA) issues, not source issues.
 */
export class PipAuditScanner extends BaseScanner {
  readonly id = 'pip-audit';
  readonly engine = 'pip-audit';
  readonly metadata = {
    id: 'pip-audit',
    engine: 'pip-audit',
    kind: 'dependency',
    languages: ['Python'],
    description: 'pip-audit: audits Python dependency manifests against the OSV database',
    networkAccess: true,
  } as const;
  protected readonly defaultConfidence = 0.9;

  isApplicable(profile: ScanTargetProfile): boolean {
    return profile.dependencySources.some((source) => source.endsWith('requirements.txt'));
  }

  buildCommand(
    context: Parameters<BaseScanner['buildCommand']>[0],
    config: Parameters<BaseScanner['buildCommand']>[1]
  ) {
    return {
      argv: [
        'pip-audit',
        '-r',
        path.join(context.localPath, 'requirements.txt'),
        '-f',
        'json',
        ...config.extraArgs,
      ],
      cwd: context.localPath,
      network: this.metadata.networkAccess,
      timeoutMs: config.timeoutMs,
    };
  }

  parse(output: { stdout: string }): readonly RawFinding[] {
    const parsed = JSON.parse(output.stdout) as PipAuditOutput;
    const findings: RawFinding[] = [];
    for (const dependency of parsed.dependencies ?? []) {
      for (const vuln of dependency.vulns ?? []) {
        const advisory = vuln.advisory ?? {};
        const references = [...(advisory.aliases ?? []), ...(advisory.links ?? [])];
        const cve = (advisory.aliases ?? []).find((alias) => alias.startsWith('CVE-')) ?? null;
        findings.push({
          type: advisory.id ?? vuln.id ?? 'osv-advisory',
          severity: advisory.severity ?? 'INFO',
          confidence: null,
          file: null,
          line: null,
          message: advisory.summary ?? `${dependency.name}: vulnerable version ${dependency.version}`,
          cwe: null,
          cve,
          references,
          evidence: `${dependency.name}@${dependency.version ?? 'unknown'}`,
          raw: vuln,
        });
      }
    }
    return findings;
  }
}