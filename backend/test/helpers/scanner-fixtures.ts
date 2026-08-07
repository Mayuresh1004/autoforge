import type { ScannerExecutor, ScannerOutput } from '../../src/static-scanner/domain/ports/scanner-executor';
import type { ScannerConfig } from '../../src/static-scanner/domain/ports/scanner';
import type { ScanContext } from '../../src/static-scanner/domain/models/scan';

// ---------------------------------------------------------------------------
// Realistic tool-output fixtures (JSON as emitted by each CLI)
// ---------------------------------------------------------------------------

export const BANDIT_JSON = JSON.stringify({
  results: [
    {
      code: 'cursor.execute("SELECT * FROM users WHERE id = " + user_id)\n',
      filename: '/repo/src/db.py',
      issue_confidence: 'HIGH',
      issue_cwe: { id: 89, link: 'https://cwe.mitre.org/data/definitions/89.html' },
      issue_severity: 'HIGH',
      issue_text: 'Possible SQL injection vector through string-based query construction.',
      line_number: 12,
      test_id: 'B608',
      test_name: 'hardcoded_sql_expressions',
    },
  ],
  errors: [],
});

export const SEMGREP_JSON = JSON.stringify({
  results: [
    {
      check_id: 'typescript.lang.security.audit.sqli',
      path: '/repo/src/user.ts',
      start: { line: 42, col: 5 },
      end: { line: 42, col: 60 },
      extra: {
        message: 'Unsanitized user input used in SQL query.',
        severity: 'ERROR',
        metadata: {
          cwe: ['CWE-89'],
          references: ['https://owasp.org/www-community/attacks/SQL_Injection'],
        },
        lines: 'const q = `SELECT * FROM users WHERE id = ${id}`;',
      },
    },
  ],
  errors: [],
});

export const NPM_AUDIT_JSON = JSON.stringify({
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 1 } },
  vulnerabilities: {
    lodash: {
      name: 'lodash',
      severity: 'moderate',
      isDirect: false,
      via: [
        {
          title: 'Prototype Pollution',
          url: 'https://github.com/advisories/GHSA-abc',
          severity: 'moderate',
          range: '>=4.17.0 <4.17.12',
        },
      ],
      range: '>=4.17.0 <4.17.21',
      nodes: ['node_modules/lodash'],
      fixAvailable: true,
    },
    minimist: {
      name: 'minimist',
      severity: 'critical',
      isDirect: true,
      via: ['GHSA-xvch-5gv4-984h'],
      range: '>=0.0.0 <1.2.3',
    },
  },
});

export const PIP_AUDIT_JSON = JSON.stringify({
  dependencies: [
    {
      name: 'django',
      version: '3.2.0',
      vulns: [
        {
          id: 'GHSA-8q4h-6x2h-9p2j',
          advisory: {
            id: 'GHSA-8q4h-6x2h-9p2j',
            aliases: ['CVE-2022-36359'],
            summary: 'Django before 3.2.15 and 4.0.7 do not limit characters.',
            severity: 'HIGH',
            cvss_v3: { score: 7.5, vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N' },
            links: ['https://osv.dev/vulnerability/GHSA-8q4h-6x2h-9p2j'],
          },
        },
      ],
    },
  ],
});

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function okOutput(stdout: string, exitCode = 0): ScannerOutput {
  return { stdout, stderr: '', exitCode, timedOut: false };
}

export function failOutput(stderr = 'boom'): ScannerOutput {
  return { stdout: '', stderr, exitCode: 1, timedOut: false };
}

export function timedOutOutput(): ScannerOutput {
  return { stdout: '', stderr: '', exitCode: null, timedOut: true };
}

/**
 * Executor stub keyed by command: `argv[0]` (e.g. `semgrep`) or
 * `argv[0] argv[1]` (e.g. `npm audit`). Throws when the handler throws.
 */
export function mockExecutor(
  handlers: Record<string, () => ScannerOutput | Promise<ScannerOutput>>
): ScannerExecutor {
  return {
    async execute(command) {
      const key = [command.argv[0], command.argv[1]].filter(Boolean).join(' ');
      const handler = handlers[key] ?? handlers[command.argv[0]];
      if (!handler) return failOutput(`no handler for ${key}`);
      return handler();
    },
  };
}

export function scannerConfig(overrides: Partial<ScannerConfig> = {}): ScannerConfig {
  return {
    enabled: true,
    timeoutMs: 30_000,
    severityThreshold: 'INFO',
    extraArgs: [],
    ...overrides,
  };
}

export function scanContext(overrides: Partial<ScanContext> = {}): ScanContext {
  return {
    scanId: 'scan_1',
    repositoryUrl: 'https://github.com/acme/demo',
    repositoryName: 'demo',
    localPath: '/repo',
    severityThreshold: 'INFO',
    ...overrides,
  };
}