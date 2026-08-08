import { describe, expect, it } from 'vitest';
import { confirmedFinding, SQLI_PATCH_DIFF, SQLI_PATCH_JSON } from '../../../../test/helpers/engineer-fakes';
import { resolvePromptsRoot } from '../../../prompts/infrastructure/fs-prompt-registry';
import { FileSystemPromptRegistry } from '../../../prompts/infrastructure/fs-prompt-registry';
import { SecurityReviewGate } from './security-review-gate';
import type { EngineerResponse } from '../../domain/models/engineer-response';

const registry = new FileSystemPromptRegistry(resolvePromptsRoot(process.env.PROMPTS_ROOT));
const gate = new SecurityReviewGate(registry);
const finding = confirmedFinding();

const GENERATED: EngineerResponse = {
  vulnerabilityId: 'vuln-1',
  status: 'GENERATED',
  filePath: 'src/app.py',
  diff: SQLI_PATCH_DIFF,
  explanation: 'parameterized query fixes the injection',
  remediation: 'parameterized query',
  assumptions: [],
  reason: null,
};

describe('security-review-gate', () => {
  it('passes a clean generated patch for the confirmed finding', async () => {
    const decision = await gate.run({ response: GENERATED, finding, sourceRead: true, ragDocsUsed: 1 });
    expect(decision.passed).toBe(true);
  });

  it('rejects a patch that targets a different vulnerability', async () => {
    const decision = await gate.run({
      response: { ...GENERATED, vulnerabilityId: 'other-vuln' },
      finding,
      sourceRead: true,
      ragDocsUsed: 0,
    });
    expect(decision.passed).toBe(false);
    expect(decision.checks.some((c) => c.itemId === 'targets-confirmed-finding' && !c.passed)).toBe(true);
  });

  it('rejects secrets appearing in the diff', async () => {
    const leak = SQLI_PATCH_DIFF.replace('cursor.execute(query, (q,))', 'cursor.execute(query, (q, "AIzaSyFakeKey1234567890abcdefghij"))');
    const decision = await gate.run({ response: { ...GENERATED, diff: leak }, finding, sourceRead: true, ragDocsUsed: 0 });
    expect(decision.passed).toBe(false);
  });

  it('rejects dangerous generated commands in the diff', async () => {
    const cmd = SQLI_PATCH_DIFF.replace('cursor.execute(query, (q,))', 'os.system("sh -c \\"rm -rf /\\"")');
    const decision = await gate.run({ response: { ...GENERATED, diff: cmd }, finding, sourceRead: true, ragDocsUsed: 0 });
    expect(decision.passed).toBe(false);
  });

  it('rejects output that claims the patch was applied', async () => {
    const decision = await gate.run({
      response: { ...GENERATED, explanation: 'I applied the patch and restarted the container' },
      finding,
      sourceRead: true,
      ragDocsUsed: 0,
    });
    expect(decision.passed).toBe(false);
  });

  it('fails when the source context was not read', async () => {
    const decision = await gate.run({ response: GENERATED, finding, sourceRead: false, ragDocsUsed: 0 });
    expect(decision.passed).toBe(false);
  });

  it('fails when the security-review template cannot be loaded', async () => {
    const brokenRegistry = { get: async () => { throw new Error('missing'); } };
    const decision = await new SecurityReviewGate(brokenRegistry as never).run({
      response: GENERATED,
      finding,
      sourceRead: true,
      ragDocsUsed: 0,
    });
    expect(decision.passed).toBe(false);
  });

  it('passes a REJECTED model response (nothing to review)', async () => {
    const decision = await gate.run({
      response: {
        vulnerabilityId: 'vuln-1',
        status: 'REJECTED',
        filePath: null,
        diff: null,
        explanation: 'insufficient context',
        remediation: 'parameterized query',
        assumptions: [],
        reason: 'cannot locate the query builder',
      },
      finding,
      sourceRead: true,
      ragDocsUsed: 0,
    });
    expect(decision.passed).toBe(true);
  });
});