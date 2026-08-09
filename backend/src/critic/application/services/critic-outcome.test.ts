/**
 * CriticOutcomeWriter + classifyFailure — the verdict classification
 * table: infra failures are NEVER fake "bad patch" rejections, and every
 * REJECTED outcome carries structured (bounded) feedback.
 */

import { describe, expect, it } from 'vitest';
import { CriticOutcomeWriter, classifyFailure } from './critic-outcome';
import { MemoryCriticRepository } from '../../../../test/helpers/critic-fakes';
import { DefaultAgentExecutionService } from '../../../agent/application/services/agent-execution.service';
import { MemoryAgentExecutionRepository } from '../../../../test/helpers/memory-agent-execution-repository';
import {
  BaselineInvalidError,
  ExploitInconclusiveError,
  ExploitStillSucceedsError,
  PatchConflictError,
  SandboxProvisionFailure,
  SecurityGateFailureError,
  ValidationInfrastructureFailure,
} from '../../domain/errors/critic.errors';

describe('classifyFailure', () => {
  it('maps infrastructure errors to FAILED with their exact kind', () => {
    const cases: Array<[unknown, string]> = [
      [new BaselineInvalidError('x'), 'BASELINE_INVALID'],
      [new SandboxProvisionFailure('x'), 'SANDBOX_PROVISION_FAILURE'],
      [new ValidationInfrastructureFailure('x'), 'VALIDATION_INFRASTRUCTURE_FAILURE'],
      [new ExploitInconclusiveError('x'), 'VALIDATION_INFRASTRUCTURE_FAILURE'],
    ];
    for (const [error, kind] of cases) {
      const classified = classifyFailure(error);
      expect(classified.status).toBe('FAILED');
      expect(classified.failureKind).toBe(kind);
      expect(classified.feedback).toBeNull();
    }
  });

  it('maps patch failures to REJECTED with bounded feedback', () => {
    const exploit = classifyFailure(new ExploitStillSucceedsError('still injected'));
    expect(exploit.status).toBe('REJECTED');
    expect(exploit.failureKind).toBe('EXPLOIT_STILL_SUCCEEDS');
    expect(exploit.feedback?.failedChecks).toContain('exploit-retest');
    expect(exploit.feedback?.guidance.length).toBeLessThanOrEqual(400);

    const gate = classifyFailure(new SecurityGateFailureError(['no-secrets', 'remediation-present']));
    expect(gate.status).toBe('REJECTED');
    expect(gate.failureKind).toBe('PATCH_REJECTED');
    expect(gate.feedback?.failedChecks).toEqual(expect.arrayContaining(['security-review', 'no-secrets']));

    const conflict = classifyFailure(new PatchConflictError('build failed: x'));
    expect(conflict.status).toBe('REJECTED');
    expect(conflict.failureKind).toBe('PATCH_REJECTED');
  });

  it('never lets unbounded error text leak into the message', () => {
    const result = classifyFailure(new ValidationInfrastructureFailure('x'.repeat(5_000)));
    expect(result.errorMessage!.length).toBeLessThanOrEqual(300);
  });
});

describe('CriticOutcomeWriter', () => {
  it('records one AgentExecution + one CriticRun row per attempt', async () => {
    const results = new MemoryCriticRepository();
    const executions = new DefaultAgentExecutionService(new MemoryAgentExecutionRepository());
    const writer = new CriticOutcomeWriter(results, executions);

    const outcome = await writer.persist({
      patchId: 'patch-1',
      vulnerabilityId: 'vuln-1',
      scanId: 'scan-1',
      attempt: 1,
      status: 'REJECTED',
      failureKind: 'EXPLOIT_STILL_SUCCEEDS',
      checks: [],
      exploit: null,
      feedback: {
        reason: 'EXPLOIT_STILL_SUCCEEDS',
        failedChecks: ['exploit-retest'],
        guidance: 'parametrize the query',
        evidence: [],
      },
      errorMessage: null,
      startedAt: new Date(),
      completedAt: new Date(),
    });

    expect(outcome.id).toBe('patch-1#1');
    expect(outcome.executionId).toBeTruthy();
    expect(outcome.failureKind).toBe('EXPLOIT_STILL_SUCCEEDS');
  });
});