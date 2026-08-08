import { describe, expect, it } from 'vitest';
import { SQLI_PATCH_DIFF } from '../../../../test/helpers/engineer-fakes';
import { validateEngineerResponse, validateDiffShape } from './response-validator';
import type { EngineerValidationExpectation } from './response-validator';

const EXPECTED: EngineerValidationExpectation = { vulnerabilityId: 'vuln-1', filePath: 'src/app.py' };

const VALID_GENERATED = {
  vulnerabilityId: 'vuln-1',
  status: 'GENERATED',
  filePath: 'src/app.py',
  diff: SQLI_PATCH_DIFF,
  explanation: 'Uses parameterized SQL so the query grammar cannot be altered by input.',
  remediation: 'parameterized query',
  assumptions: ['q is the only injectable parameter'],
  reason: null,
};

describe('response-validator', () => {
  it('accepts a well-formed GENERATED response', () => {
    const result = validateEngineerResponse(VALID_GENERATED, EXPECTED);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.status).toBe('GENERATED');
      expect(result.response.filePath).toBe('src/app.py');
    }
  });

  it('rejects non-object / null responses (malformed output)', () => {
    for (const raw of [null, 42, 'text', [], undefined]) {
      const result = validateEngineerResponse(raw, EXPECTED);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects unknown statuses', () => {
    const result = validateEngineerResponse({ ...VALID_GENERATED, status: 'SENTIENT' }, EXPECTED);
    expect(result.ok).toBe(false);
  });

  it('rejects a vulnerabilityId mismatch (must target the requested finding)', () => {
    const result = validateEngineerResponse({ ...VALID_GENERATED, vulnerabilityId: 'vuln-other' }, EXPECTED);
    expect(result.ok).toBe(false);
  });

  it('rejects REJECTED responses without a reason, or with a diff', () => {
    const noReason = validateEngineerResponse(
      { vulnerabilityId: 'vuln-1', status: 'REJECTED', filePath: null, diff: null, explanation: 'x', remediation: 'y', assumptions: [], reason: '' },
      EXPECTED,
    );
    expect(noReason.ok).toBe(false);

    const withDiff = validateEngineerResponse(
      { ...VALID_GENERATED, status: 'REJECTED', reason: 'insufficient context' },
      EXPECTED,
    );
    expect(withDiff.ok).toBe(false);
  });

  it('accepts a well-formed REJECTED response with a reason', () => {
    const result = validateEngineerResponse(
      { vulnerabilityId: 'vuln-1', status: 'REJECTED', filePath: null, diff: null, explanation: 'no file context', remediation: 'parameterized query', assumptions: [], reason: 'insufficient context to propose a patch' },
      EXPECTED,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.response.status).toBe('REJECTED');
  });

  it('rejects path traversal (../) and absolute host paths', () => {
    for (const badPath of ['../etc/passwd', '/etc/passwd', '..\\win.ini', 'a/../../b.py', 'C:\\x']) {
      const result = validateEngineerResponse({ ...VALID_GENERATED, filePath: badPath }, EXPECTED);
      expect(result.ok).toBe(false, `path ${badPath} should be rejected`);
    }
  });

  it('rejects unsupported file targets (lockfiles, binaries)', () => {
    for (const badPath of ['package-lock.json', 'img/logo.png', 'dist/app.min.js']) {
      const result = validateEngineerResponse({ ...VALID_GENERATED, filePath: badPath }, EXPECTED);
      expect(result.ok).toBe(false, `target ${badPath} should be rejected`);
    }
  });

  it('rejects a filePath that does not match the finding target', () => {
    const result = validateEngineerResponse({ ...VALID_GENERATED, filePath: 'other/route.js' }, EXPECTED);
    expect(result.ok).toBe(false);
  });

  it('rejects unrelated files declared by the diff (bounded surface)', () => {
    const multi = SQLI_PATCH_DIFF + '\n--- a/unrelated.py\n+++ b/unrelated.py\n@@ -1 +1 @@\n-a\n+b\n';
    const result = validateEngineerResponse({ ...VALID_GENERATED, diff: multi }, EXPECTED);
    expect(result.ok).toBe(false);
  });

  it('rejects paths inside the diff (traversal + unsupported)', () => {
    const traversal = SQLI_PATCH_DIFF.replace('+++ b/src/app.py', '+++ b/../../outside.py');
    const failsSafe = validateDiffShape(traversal, { maxDiffChars: 16_000, maxPatchFiles: 3 });
    expect(failsSafe.length).toBeGreaterThan(0);
  });

  it('rejects an oversized diff (bounded diff size)', () => {
    const huge = '--- a/README.md\n+++ b/README.md\n@@ -1,1 +1,1 @@\n' + ('+a\n'.repeat(10_000));
    const result = validateEngineerResponse(
      { ...VALID_GENERATED, diff: huge },
      EXPECTED,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects empty diffs for GENERATED', () => {
    const result = validateEngineerResponse({ ...VALID_GENERATED, diff: '' }, EXPECTED);
    expect(result.ok).toBe(false);
  });

  it('rejects non-unified-diff shape', () => {
    for (const diff of ['just some text', '--- a\n@@ -1 +1 @@\n'] ) {
      const result = validateEngineerResponse({ ...VALID_GENERATED, diff }, EXPECTED);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a missing or empty explanation', () => {
    expect(validateEngineerResponse({ ...VALID_GENERATED, explanation: '' }, EXPECTED).ok).toBe(false);
  });

  it('rejects oversized explanations and assumption lists', () => {
    expect(validateEngineerResponse({ ...VALID_GENERATED, explanation: 'x'.repeat(5_000) }, EXPECTED).ok).toBe(false);
    expect(
      validateEngineerResponse(
        { ...VALID_GENERATED, assumptions: Array.from({ length: 20 }, (_, i) => `a${i}`) },
        EXPECTED,
      ).ok,
    ).toBe(false);
  });
});