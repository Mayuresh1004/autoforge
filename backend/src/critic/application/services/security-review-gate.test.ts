/**
 * Deterministic security gate — data-driven checklist, no templates, no LLM.
 */

import { describe, expect, it } from 'vitest';
import { CriticSecurityReviewGate } from './security-review-gate';
import { CRITIC_FIXTURE_DIFF } from '../../../../test/helpers/critic-fakes';

const gate = new CriticSecurityReviewGate();

function goodDiff(): string {
  return CRITIC_FIXTURE_DIFF;
}

describe('CriticSecurityReviewGate', () => {
  it('passes a clean parameterizing diff', () => {
    const result = gate.run({ filePath: 'src/app.py', diff: goodDiff() });
    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it('rejects when secrets are introduced', () => {
    const diff = goodDiff() + '\n+    api_key = "sk-abcdef0123456789"\n';
    const result = gate.run({ filePath: 'src/app.py', diff });
    expect(result.passed).toBe(false);
    const secrets = result.checks.find((c) => c.label === 'no-secrets');
    expect(secrets?.passed).toBe(false);
  });

  it('rejects dangerous constructs added by the patch', () => {
    const diff = goodDiff() + '\n+    eval(user_input)\n';
    const result = gate.run({ filePath: 'src/app.py', diff });
    const dangerous = result.checks.find((c) => c.label === 'no-dangerous-constructs');
    expect(dangerous?.passed).toBe(false);
  });

  it('rejects dependency-manifest changes', () => {
    const result = gate.run({ filePath: 'package.json', diff: goodDiff() });
    const deps = result.checks.find((c) => c.label === 'no-dependency-changes');
    expect(deps?.passed).toBe(false);
  });

  it('rejects multi-file diffs', () => {
    const diff =
      goodDiff() +
      '\n--- a/other.py\n+++ b/other.py\n@@ -1,1 +1,1 @@\n-x\n+y\n';
    const result = gate.run({ filePath: 'src/app.py', diff });
    const single = result.checks.find((c) => c.label === 'single-file-diff');
    expect(single?.passed).toBe(false);
  });

  it('rejects diffs without a remediation (parameterization) signal', () => {
    const diff = goodDiff().replace(
      'cur.execute("SELECT * FROM users WHERE id = %s", (user_input,))',
      'cur.execute("SELECT * FROM users WHERE id = %s")',
    );
    const result = gate.run({ filePath: 'src/app.py', diff });
    const remediation = result.checks.find((c) => c.label === 'remediation-present');
    expect(remediation?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });
});