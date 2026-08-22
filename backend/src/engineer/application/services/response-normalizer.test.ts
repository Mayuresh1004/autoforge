import { describe, it, expect } from 'vitest';
import { normalizeEngineerLlmResponse } from './response-normalizer';
import { validateEngineerResponse } from './response-validator';
import { InvalidEngineerResponseError } from '../../domain/errors/engineer.errors';

describe('Engineer Response Normalizer & Boundary Tests', () => {
  const expectation = {
    vulnerabilityId: 'vuln_123',
    filePath: 'server/routes/users.js',
  };

  const validPayload = {
    vulnerabilityId: 'vuln_123',
    status: 'GENERATED',
    filePath: 'server/routes/users.js',
    originalCode: 'const q = req.query.q;\ndb.query("SELECT * FROM users WHERE name = " + q);',
    patchedCode: 'const q = req.query.q;\ndb.query("SELECT * FROM users WHERE name = ?", [q]);',
    explanation: 'Used parameterized query to prevent SQL injection',
    remediation: 'parameterized query',
    assumptions: ['Database driver supports parameter binding'],
    reason: null,
  };

  it('Case A: Already-parsed JSON object → accepted', () => {
    const normalized = normalizeEngineerLlmResponse(validPayload);
    const validated = validateEngineerResponse(normalized, expectation);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.response.status).toBe('GENERATED');
      expect(validated.response.vulnerabilityId).toBe('vuln_123');
    }
  });

  it('Case B: JSON string → parsed and accepted', () => {
    const jsonString = JSON.stringify(validPayload);
    const normalized = normalizeEngineerLlmResponse(jsonString);
    const validated = validateEngineerResponse(normalized, expectation);
    expect(validated.ok).toBe(true);
  });

  it('Case C: ```json fenced JSON → parsed and accepted', () => {
    const fenced = `\`\`\`json\n${JSON.stringify(validPayload, null, 2)}\n\`\`\``;
    const normalized = normalizeEngineerLlmResponse(fenced);
    const validated = validateEngineerResponse(normalized, expectation);
    expect(validated.ok).toBe(true);
  });

  it('Case D: Plain invalid text → structural validation fails', () => {
    const invalidText = 'Sorry, as an AI model I cannot fix this code.';
    const normalized = normalizeEngineerLlmResponse(invalidText);
    const validated = validateEngineerResponse(normalized, expectation);
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.failures).toContain('response must be a JSON object');
    }
  });

  it('Case E: Valid JSON with missing required fields → structural validation fails', () => {
    const incompletePayload = {
      vulnerabilityId: 'vuln_123',
      status: 'GENERATED',
      // missing filePath, originalCode, patchedCode, explanation, remediation
    };
    const normalized = normalizeEngineerLlmResponse(incompletePayload);
    const validated = validateEngineerResponse(normalized, expectation);
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.failures.some((f) => f.includes('filePath') || f.includes('explanation'))).toBe(true);
    }
  });

  it('Case F: Provider wrapper/content response → normalized correctly', () => {
    const wrappedInChoices = {
      choices: [
        {
          message: {
            content: `\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\``,
          },
        },
      ],
    };
    const normalized = normalizeEngineerLlmResponse(wrappedInChoices);
    const validated = validateEngineerResponse(normalized, expectation);
    expect(validated.ok).toBe(true);

    const wrappedInCandidates = {
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify(validPayload) }],
          },
        },
      ],
    };
    const normalizedCandidates = normalizeEngineerLlmResponse(wrappedInCandidates);
    const validatedCandidates = validateEngineerResponse(normalizedCandidates, expectation);
    expect(validatedCandidates.ok).toBe(true);
  });

  it('Case G: Existing valid Engineer REJECTED response → regression test', () => {
    const rejectedPayload = {
      vulnerabilityId: 'vuln_123',
      status: 'REJECTED',
      filePath: null,
      diff: null,
      explanation: 'Insufficient source code context',
      remediation: 'parameterized query',
      assumptions: [],
      reason: 'Insufficient source code context',
    };
    const normalized = normalizeEngineerLlmResponse(rejectedPayload);
    const validated = validateEngineerResponse(normalized, expectation);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.response.status).toBe('REJECTED');
    }
  });
});
