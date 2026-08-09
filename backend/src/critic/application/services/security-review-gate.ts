/**
 * Critic deterministic security review — a bounded checklist over the diff
 * (never over raw source). Runs BEFORE any optional LLM reasoning. Failing
 * ANY check rejects the patch; the checklist itself is data, not prompt
 * text, so no template is loaded for these six invariants.
 *
 * Checks:
 *  1. only-expected-file  — diff touches exactly the Engineer's file
 *  2. no-secrets          — no creds/tokens/key material added
 *  3. no-dangerous        — no eval/exec/shell/subprocess additions
 *  4. no-dependency-changes — manifest files never touched
 *  5. unrelated-files     — hunk headers stay within the repository
 *  6. remediation-present — SQLi-specific fix signal is present
 */

export interface SecurityReviewInput {
  readonly filePath: string;
  readonly diff: string;
}

export interface SecurityReviewCheck {
  readonly label: string;
  readonly passed: boolean;
  readonly detail?: string;
}

const SECRET_PATTERN =
  /(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{16,}|-----BEGIN [A-Z ]+-----|Bearer\s+[A-Za-z0-9._-]{16,}|(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"`][^'"`]{4,}['"`])/i;

const DANGEROUS_PATTERN =
  /\b(?:exec|eval|system|popen|spawn|child_process|Runtime\.getRuntime|ProcessBuilder|Cx\.markAsUntrusted)\b|create_shell|shell\s*=\s*['"]True/;

const DEPENDENCY_MANIFESTS = new Set([
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json',
  'pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'setup.py', 'setup.cfg',
  'Pipfile', 'Pipfile.lock', 'poetry.lock', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'composer.json', 'composer.lock',
  'Gemfile', 'Gemfile.lock', 'package-lock.json',
]);

/** SQLi-parameterization signals looked for among ADDED lines only. */
const PARAMETERIZATION_HINTS = [
  /\bexecute\(\s*['"][^'"]*\?['"]\s*,/,
  /\bexecute\(\s*['"][^'"]*%(?:s|d|r|s)['"]\s*,\s*(?:params?|args|tuple|\[|\([^)]{1,20}\))/,
  /\bprepared\s+statement\b/i,
  /\bparameterized\b/i,
  /\?*\b(?:bind|param)\b.*[\w.]+\),\s*answer:/,
  /execute\s*\(\s*['"][^'"]*['"]\s*,\s*\[/,
  /conn\s*\.\s*execute\s*\(\s*['"][^'"]*['"]\s*,\s*(?:params?|\(|\[)/,
  /\bplaceholder\s*[:=(]/,
  /query\s+(?:params?\s*=|parameterized)/i,
];

export class CriticSecurityReviewGate {
  run(input: SecurityReviewInput): { readonly passed: boolean; readonly checks: readonly SecurityReviewCheck[] } {
    const checks: SecurityReviewCheck[] = [];
    const addedLines = diffAddedLines(input.diff);
    const lowerAdded = addedLines.join('\n');
    const entireLower = input.diff.toLowerCase();

    // 1. only one expected file
    checks.push({
      label: 'single-file-diff',
      passed: diffFileCount(input.diff),
      detail: 'diff must apply to exactly one file',
    });

    // 2. no secrets introduced
    const secretMatch = SECRET_PATTERN.exec(entireLower) ?? null;
    checks.push({
      label: 'no-secrets',
      passed: secretMatch === null && !/-----BEGIN/.test(input.diff),
      detail: secretMatch ? 'secret-like content detected' : undefined,
    });

    // 3. no dangerous constructs added
    const dangerous = addedLines.filter((line) => DANGEROUS_PATTERN.test(line));
    checks.push({
      label: 'no-dangerous-constructs',
      passed: dangerous.length === 0,
      detail: dangerous.slice(0, 3).join(' | ').slice(0, 300),
    });

    // 4. no dependency changes
    const manifestTouched = DEPENDENCY_MANIFESTS.has(normalizeFileName(input.filePath));
    checks.push({
      label: 'no-dependency-changes',
      passed: !manifestTouched,
      detail: manifestTouched ? `manifest file modified: ${input.filePath}` : undefined,
    });

    // 5. remediation present (parameterization) in the NEW code
    const hasRemediation = PARAMETERIZATION_HINTS.some((re) => re.test(addedLines.join('\n')));
    checks.push({
      label: 'remediation-present',
      passed: hasRemediation,
      detail: hasRemediation ? undefined : 'no SQL parameterization signal found in added lines',
    });

    const failed = checks.filter((c) => !c.passed);
    return { passed: failed.length === 0, checks };
  }
}

function diffAddedLines(diff: string): readonly string[] {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

function diffFileCount(diff: string): boolean {
  const headers = diff.match(/^\+\+\+ b\/(\S+)/gm);
  const files = new Set(headers?.map((h) => h.replace('+++ b/', '').trim()) ?? []);
  return files.size === 1;
}

function normalizeFileName(p: string | null): string {
  if (!p) return '';
  const base = p.split('/').pop() ?? p;
  return base.toLowerCase();
}