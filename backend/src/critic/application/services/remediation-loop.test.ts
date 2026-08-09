/**
 * RemediationLoopService — engineer↔critic retry driver. Bounded attempts,
 * deterministic feedback hand-off, no patch application anywhere.
 */

import { describe, expect, it } from 'vitest';
import { RemediationLoopService } from './remediation-loop.service';
import type { EngineerRunInput, EngineerRunResult, EngineerService } from '../../../engineer/application/services/engineer.service';
import type { CriticRunInput, CriticService } from './critic.service';
import type { CriticRunResult } from '../../domain/models/critic-result';
import type { CriticFeedback } from '../../domain/models/critic-result';

function engineerResult(overrides: Partial<EngineerRunResult> = {}): EngineerRunResult {
  return {
    executionId: 'eng-1',
    vulnerabilityId: 'vuln-1',
    patchId: 'patch-1',
    status: 'GENERATED',
    summary: { sourceLines: 40, ragDocs: 0, reviewPassed: true, model: 'fake', diffChars: 120, reason: null },
    ...overrides,
  };
}

function criticResult(overrides: Partial<CriticRunResult> = {}): CriticRunResult {
  return {
    id: 'patch-1#1',
    patchId: 'patch-1',
    vulnerabilityId: 'vuln-1',
    scanId: 'scan-1',
    executionId: 'critic-1',
    attempt: 1,
    status: 'APPROVED',
    failureKind: null,
    errorMessage: null,
    checks: [],
    exploit: null,
    feedback: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

class StubEngineer implements EngineerService {
  readonly calls: Array<{ scanId: string; vulnerabilityId?: string; feedback?: unknown }> = [];
  private results: EngineerRunResult[] = [];
  error: Error | null = null;

  script(...results: EngineerRunResult[]): void {
    this.results = results;
  }

  async run(input: EngineerRunInput): Promise<EngineerRunResult> {
    this.calls.push({ scanId: input.scanId, vulnerabilityId: input.vulnerabilityId, feedback: input.feedback });
    if (this.error) throw this.error;
    const next = this.results.shift();
    if (!next) throw new Error('no scripted engineer result');
    return next;
  }
  async getRun(): Promise<null> {
    return null;
  }
}

class StubCritic implements CriticService {
  readonly calls: CriticRunInput[] = [];
  results: CriticRunResult[] = [];

  script(results: CriticRunResult[]): void {
    this.results = results;
  }

  async run(input: CriticRunInput): Promise<CriticRunResult> {
    this.calls.push(input);
    const next = this.results.shift();
    if (!next) throw new Error('no scripted critic result');
    return { ...next, attempt: input.attempt ?? next.attempt };
  }
  async getRun(): Promise<CriticRunResult | null> {
    return null;
  }
}

describe('RemediationLoopService', () => {
  it('approves on the first attempt', async () => {
    const engineer = new StubEngineer();
    const critic = new StubCritic();
    engineer.script(engineerResult());
    critic.script([criticResult()]);
    const loop = new RemediationLoopService({ engineer, critic, maxEngineerAttempts: 3 });

    const result = await loop.run({ scanId: 'scan-1' });

    expect(result.finalStatus).toBe('APPROVED');
    expect(result.attempts).toHaveLength(1);
    expect(engineer.calls).toHaveLength(1);
    expect(critic.calls[0].patchId).toBe('patch-1');
    expect(critic.calls[0].attempt).toBe(1);
  });

  it('retries once after a rejection, carrying feedback into the next engineer run', async () => {
    const engineer = new StubEngineer();
    const critic = new StubCritic();
    const feedback: CriticFeedback = {
      reason: 'EXPLOIT_STILL_SUCCEEDS',
      failedChecks: ['exploit-retest'],
      guidance: 'parametrize the parameter',
      evidence: [],
    };
    engineer.script(engineerResult({ patchId: 'patch-1' }), engineerResult({ patchId: 'patch-2' }));
    critic.script([
      criticResult({ status: 'REJECTED', failureKind: 'EXPLOIT_STILL_SUCCEEDS', feedback }),
      criticResult({ patchId: 'patch-2', id: 'patch-2#2', status: 'APPROVED' }),
    ]);
    const loop = new RemediationLoopService({ engineer, critic, maxEngineerAttempts: 3 });

    const result = await loop.run({ scanId: 'scan-1' });

    expect(result.finalStatus).toBe('APPROVED');
    expect(result.attempts).toHaveLength(2);
    expect(critic.calls.map((c) => c.attempt)).toEqual([1, 2]);
    const second = engineer.calls[1];
    expect(second.feedback).toEqual({
      reason: 'EXPLOIT_STILL_SUCCEEDS',
      failedChecks: ['exploit-retest'],
      guidance: 'parametrize the parameter',
      attempt: 1,
    });
  });

  it('stops REJECTED when max attempts are exhausted', async () => {
    const engineer = new StubEngineer();
    const critic = new StubCritic();
    const feedback: CriticFeedback = { reason: 'PATCH_REJECTED', failedChecks: ['build'], guidance: 'fix build', evidence: [] };
    engineer.script(
      engineerResult({ patchId: 'patch-1' }),
      engineerResult({ patchId: 'patch-2' }),
      engineerResult({ patchId: 'patch-3' }),
    );
    critic.script([
      criticResult({ patchId: '1', status: 'REJECTED', failureKind: 'PATCH_REJECTED', feedback }),
      criticResult({ id: '2', patchId: '2', status: 'REJECTED', failureKind: 'PATCH_REJECTED', feedback }),
      criticResult({ id: '3', patchId: '3', status: 'REJECTED', failureKind: 'PATCH_REJECTED', feedback }),
    ]);
    const loop = new RemediationLoopService({ engineer, critic, maxEngineerAttempts: 2 });

    const result = await loop.run({ scanId: 'scan-1' });

    expect(result.finalStatus).toBe('REJECTED');
    expect(result.reason).toContain('max');
    expect(result.attempts).toHaveLength(2);
  });

  it('stops FAILED when validation infrastructure breaks', async () => {
    const engineer = new StubEngineer();
    const critic = new StubCritic();
    engineer.script(engineerResult());
    critic.script([criticResult({ status: 'FAILED', failureKind: 'SANDBOX_PROVISION_FAILURE' })]);
    const loop = new RemediationLoopService({ engineer, critic, maxEngineerAttempts: 3 });

    const result = await loop.run({ scanId: 'scan-1' });

    expect(result.finalStatus).toBe('FAILED');
    expect(result.reason).toContain('SANDBOX_PROVISION_FAILURE');
  });

  it('treats an engineer decline as terminal REJECTED', async () => {
    const engineer = new StubEngineer();
    const critic = new StubCritic();
    engineer.script(engineerResult({ status: 'REJECTED', patchId: null, summary: { ...engineerResult().summary, reason: 'insufficient context' as string | null } }));
    const loop = new RemediationLoopService({ engineer, critic, maxEngineerAttempts: 3 });

    const result = await loop.run({ scanId: 'scan-1' });

    expect(result.finalStatus).toBe('REJECTED');
    expect(result.reason).toContain('insufficient context');
    expect(critic.calls).toHaveLength(0);
  });

  it('stops FAILED when the engineer crashes', async () => {
    const engineer = new StubEngineer();
    engineer.error = new Error('LLM outage');
    const critic = new StubCritic();
    const loop = new RemediationLoopService({ engineer, critic, maxEngineerAttempts: 3 });

    const result = await loop.run({ scanId: 'scan-1' });

    expect(result.finalStatus).toBe('FAILED');
    expect(result.reason).toContain('LLM');
  });
});