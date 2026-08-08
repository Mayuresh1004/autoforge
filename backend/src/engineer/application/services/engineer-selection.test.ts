import { describe, expect, it } from 'vitest';
import { confirmedFinding } from '../../../../test/helpers/engineer-fakes';
import {
  compareCandidates,
  isSupportedConfirmedFinding,
  selectConfirmedSqlInjection,
} from './engineer-selection';

describe('engineer-selection', () => {
  it('selects the highest severity confirmed SQL-injection finding', () => {
    const critical = confirmedFinding({ vulnerabilityId: 'v2', severity: 'CRITICAL', confidence: 0.5 });
    const high = confirmedFinding({ vulnerabilityId: 'v1', severity: 'HIGH', confidence: 0.95 });
    const selected = selectConfirmedSqlInjection([high, critical]);
    expect(selected?.vulnerabilityId).toBe('v2');
  });

  it('uses confidence as a tie-breaker within the same severity (advisory only)', () => {
    const a = confirmedFinding({ vulnerabilityId: 'a', severity: 'HIGH', confidence: 0.6 });
    const b = confirmedFinding({ vulnerabilityId: 'b', severity: 'HIGH', confidence: 0.9 });
    expect(selectConfirmedSqlInjection([a, b])?.vulnerabilityId).toBe('b');
  });

  it('breaks ties by exploit depth then stable vulnerabilityId', () => {
    const shallow = confirmedFinding({ vulnerabilityId: 'z', severity: 'HIGH', confidence: 0.5, exploitDepth: 1 });
    const deep = confirmedFinding({ vulnerabilityId: 'a', severity: 'HIGH', confidence: 0.5, exploitDepth: 5 });
    expect(selectConfirmedSqlInjection([shallow, deep])?.vulnerabilityId).toBe('a');
    const tieA = confirmedFinding({ vulnerabilityId: 'b', severity: 'HIGH', confidence: 0.5, exploitDepth: 2 });
    const tieB = confirmedFinding({ vulnerabilityId: 'a', severity: 'HIGH', confidence: 0.5, exploitDepth: 2 });
    expect(selectConfirmedSqlInjection([tieA, tieB])?.vulnerabilityId).toBe('a');
  });

  it('is deterministic for the same input (stable sort)', () => {
    const candidates = [
      confirmedFinding({ vulnerabilityId: 'x', severity: 'LOW' }),
      confirmedFinding({ vulnerabilityId: 'y', severity: 'CRITICAL', confidence: 0.9 }),
      confirmedFinding({ vulnerabilityId: 'z', severity: 'CRITICAL', confidence: 0.9, exploitDepth: 1 }),
    ];
    const first = selectConfirmedSqlInjection([...candidates].reverse());
    const second = selectConfirmedSqlInjection([...candidates]);
    expect(first?.vulnerabilityId).toBe(second?.vulnerabilityId);
  });

  it('returns null when nothing is confirmed + SQL injection', () => {
    const unconfirmed = confirmedFinding({ status: 'INCONCLUSIVE' as never });
    const notSqli = confirmedFinding({ type: 'XSS' as never });
    expect(selectConfirmedSqlInjection([unconfirmed, notSqli])).toBeNull();
  });

  it('verifies NOT_CONFIRMED candidates are rejected up-front', () => {
    expect(isSupportedConfirmedFinding(confirmedFinding({ status: 'NOT_CONFIRMED' as never }))).toBe(false);
  });

  it('compareCandidates never overrides confirmed status (both supported → order still deterministic)', () => {
    const a = confirmedFinding({ vulnerabilityId: 'a', severity: 'MEDIUM', confidence: 1.0 });
    const b = confirmedFinding({ vulnerabilityId: 'b', severity: 'CRITICAL', confidence: 0.1 });
    expect(compareCandidates(a, b) > 0).toBe(true);
  });
});