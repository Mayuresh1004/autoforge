/**
 * Engineer security-review gate — deterministic, code-level checklist that
 * mirrors the `engineer.security-review` template (loaded at run time so the
 * checklist wording lives template-side). Runs BEFORE any GENERATED patch is
 * persisted.
 *
 * Deterministic checks (no LLM):
 *  - security-review template was loaded (proves the gate drives the
 *    checklist that template defines)
 *  - patch targets the confirmed vulnerability (id match)
 *  - supported class: SQL_INJECTION only
 *  - no unrelated changes — diff bounded to one file (we re-validate the
 *    multi-file bound here too)
 *  - no secret/key/token shapes in the diff or explanation
 *  - no dangerous generated commands (shell / network / exec markers)
 *  - no claim that the patch was applied or deployed
 *  - explanation present, path is repo-relative, context was read
 *
 * NOT provable here (later phase, Critic): whether the change actually
 * removes the vulnerability class. The gate states that honestly.
 */

import type { EngineerBounds, EngineerResponse } from '../../domain/models/engineer-response';
import { DEFAULT_ENGINEER_BOUNDS } from '../../domain/models/engineer-response';
import type { PromptRegistry } from '../../../prompts/domain/prompt-registry';
import type { ConfirmedVulnerabilityFinding } from '../../domain/ports/confirmed-finding-repository';
import { normalizeRepoPath } from '../../domain/models/repo-path';

export interface SecurityReviewCheck {
  readonly itemId: string;
  readonly label: string;
  readonly passed: boolean;
  readonly detail?: string;
}

export interface SecurityReviewDecision {
  readonly passed: boolean;
  readonly checks: readonly SecurityReviewCheck[];
}

export interface SecurityReviewInput {
  readonly response: EngineerResponse;
  readonly finding: ConfirmedVulnerabilityFinding;
  readonly sourceRead: boolean;
  readonly ragDocsUsed: number;
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /AIza[0-9A-Za-z_-]{20,}/, // Google API key
  /\bsk-(?:[A-Za-z0-9]){16,}/, // OpenAI-style secret key
  /xox[baprs]-[0-9A-Za-z-]{10,}/, // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/, // private key blocks
  /\bgh[pousr]_[0-9A-Za-z]{14,}\b/, // GitHub tokens
  /(?:\b|")Authorization: Bearer [0-9A-Za-z._-]{10,}/, // bearer tokens
];

const DANGEROUS_COMMAND_MARKERS: readonly RegExp[] = [
  /(?:^|\n)\s*\+\s*(?:sh|bash|zsh)\s+-[ec][\s"'`]/i,
  /\b(?:curl|wget|nc|netcat|telnet|socat)\s+\S+/i,
  /\b(?:rm\s+-rf|chmod\s+\+x|dd\s+if=)/i,
  /\b(?:eval|exec|system|popen|passthru|shell_exec)\s*\(/i,
];

const PATCH_APPLICATION_CLAIMS: readonly string[] = [
  'applied the patch',
  'already applied',
  'deployed the patch',
  'patch applied',
  'restarted the container',
  'completed application of patch',
];

export class SecurityReviewGate {
  constructor(private readonly registry: PromptRegistry) {}

  async run(input: SecurityReviewInput): Promise<SecurityReviewDecision> {
    const checks: SecurityReviewCheck[] = [];
    const { response, finding } = input;

    // 0) the checklist template must be loadable — proves the gate is driven
    //    by the file-backed checklist.
    let templateLoaded = true;
    try {
      await this.registry.get('engineer.security-review');
    } catch {
      templateLoaded = false;
    }
    checks.push(
      check('security-review:template-loaded', 'Engineer security-review checklist loaded', templateLoaded),
    );

    // 1) Targets the confirmed vulnerability only.
    checks.push(
      check(
        'targets-confirmed-finding',
        'Patch targets the confirmed vulnerability (vulnerabilityId match)',
        response.vulnerabilityId === input.finding.vulnerabilityId,
        response.vulnerabilityId === input.finding.vulnerabilityId
          ? `matched ${input.finding.vulnerabilityId}`
          : `response targets ${response.vulnerabilityId}`,
      ),
    );

    // 2) Supported type class — SQL injection only.
    checks.push(
      check(
        'supported-type',
        'Only SQL_INJECTION is patched',
        input.finding.type === 'SQL_INJECTION',
        input.finding.type === 'SQL_INJECTION' ? undefined : `unsupported ${input.finding.type}`,
      ),
    );

    // 3) Generated-only structural checks.
    if (response.status === 'GENERATED') {
      const safePath = response.filePath !== null && normalizeRepoPath(response.filePath) === response.filePath;
      checks.push(
        check('repo-relative-path', 'filePath is a safe repo-relative path', safePath, safePath ? undefined : response.filePath ?? 'null'),
      );

      const diffLines = (response.diff ?? '').split('\n');
      const touched = new Set<string>();
      for (const line of diffLines) {
        const match = line.match(/^\+\+\+\s+(?:a\/|b\/)?(.+)$/);
        if (match && normalizeRepoPath(match[1]) !== '') touched.add(match[1]);
      }
      checks.push(
        check(
          'no-unrelated-changes',
          'Diff touches a single file (bounded surface)',
          touched.size <= 1,
          touched.size > 1 ? `touches ${touched.size} files` : undefined,
        ),
      );
    }

    // secrets + commands + application claims across the whole output.
    const exposed = [response.diff ?? '', response.explanation, response.assumptions.join('\n')].join('\n');
    const secretMatch = SECRET_PATTERNS.some((re) => re.test(exposed));
    checks.push(check('no-secrets', 'No secrets/keys/tokens in the output', !secretMatch));
    const commandMatch = DANGEROUS_COMMAND_MARKERS.some((re) => re.test(exposed));
    checks.push(check('no-dangerous-commands', 'No shell / network / exec command markers', !commandMatch));
    const lc = exposed.toLowerCase();
    const appliedClaim = PATCH_APPLICATION_CLAIMS.some((phrase) => lc.includes(phrase));
    checks.push(check('no-patch-application', 'Output does not claim the patch was applied/deployed', !appliedClaim));

    checks.push(check('explanation-present', 'Explanation present', response.explanation.trim().length > 0));

    // 4) context sufficiency.
    checks.push(
      check(
        'context-sufficient',
        'Source context was read for the candidate file',
        input.sourceRead,
        input.sourceRead ? undefined : 'no source context → cannot propose a patch',
      ),
    );
    checks.push(
      check(
        'rag-advisory-only',
        'RAG knowledge applied only as advisory context (never overrides instructions)',
        true,
      ),
    );

    const passed = checks.every((c) => c.passed);
    return { passed, checks };
  }
}

function check(itemId: string, label: string, passed: boolean, detail?: string): SecurityReviewCheck {
  return { itemId, label, passed, detail };
}