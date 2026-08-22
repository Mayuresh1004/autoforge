import { describe, expect, it } from 'vitest';
import { summarize } from './scan';

describe('ScanSummary calculation', () => {
  it('calculates confirmed finding counts correctly', () => {
    const findings = [
      { severity: 'HIGH' as const, status: 'CONFIRMED' },
      { severity: 'HIGH' as const, status: 'EXPLOITABLE' },
      { severity: 'MEDIUM' as const, status: 'DETECTED' },
      { severity: 'LOW' as const, status: 'NOT_CONFIRMED' },
      { severity: 'INFO' as const, status: 'NOT_TESTED' },
    ];

    const summary = summarize(findings);
    expect(summary.total).toBe(5);
    expect(summary.high).toBe(2);
    expect(summary.medium).toBe(1);
    expect(summary.low).toBe(1);
    expect(summary.info).toBe(1);
    expect(summary.confirmed).toBe(2);
  });

  it('preserves NOT_TESTED and NOT_CONFIRMED without counting them as confirmed', () => {
    const findings = [
      { severity: 'HIGH' as const, status: 'NOT_TESTED' },
      { severity: 'HIGH' as const, status: 'NOT_CONFIRMED' },
    ];

    const summary = summarize(findings);
    expect(summary.total).toBe(2);
    expect(summary.confirmed ?? 0).toBe(0);
  });
});
