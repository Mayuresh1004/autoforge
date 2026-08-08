import { describe, expect, it } from 'vitest';
import { createAgentScanContext } from './agent-scan-context';

const minimal = { scanId: 'scan-123' };

describe('AgentScanContext', () => {
  it('builds a valid minimal context with only scanId', () => {
    const context = createAgentScanContext(minimal);
    expect(context.scanId).toBe('scan-123');
    expect(context.repository).toBeUndefined();
    expect(context.repositoryProfile).toBeUndefined();
    expect(context.runtimeContext).toBeUndefined();
    expect(context.staticFindings).toBeUndefined();
    expect(context.staticFindingSummary).toBeUndefined();
    expect(context.attackSurface).toBeUndefined();
    expect(context.attackPlan).toBeUndefined();
    expect(context.verifiedExploits).toBeUndefined();
    expect(context.createdAt).toBeTruthy();
  });

  it('attaches every optional field when provided', () => {
    const context = createAgentScanContext({
      scanId: 'scan-1',
      repository: { name: 'amass', url: 'https://github.com/example/amass', path: '/tmp/amass' },
      staticFindings: [
        {
          id: 'f1',
          title: 'SQLi in quotes',
          description: 'unsafe concatenation',
          severity: 'HIGH',
          ruleId: 'bandit.B608',
          filePath: 'app.py',
          cveId: null,
        },
      ],
      staticFindingSummary: { total: 1, high: 1, medium: 0, low: 0 },
      verifiedExploits: [{ targetId: 't1', vulnerabilityType: 'SQLI', status: 'CONFIRMED', confidence: 0.9 }],
    });
    expect(context.staticFindings?.[0].filePath).toBe('app.py');
    expect(context.staticFindingSummary?.total).toBe(1);
    expect(context.verifiedExploits?.[0]?.status).toBe('CONFIRMED');
  });

  it('rejects a missing/blank scanId', () => {
    expect(() => createAgentScanContext({ scanId: '' })).toThrowError(TypeError);
    expect(() => createAgentScanContext({ scanId: '   ' })).toThrowError(TypeError);
  });

  it('is serializable and contains no Docker internals', () => {
    const context = createAgentScanContext({
      scanId: 'scan-1',
      repository: { url: 'https://example.com/repo' },
      staticFindings: [
        { id: 'f1', title: 'x', description: 'y', severity: 'LOW', ruleId: null, filePath: null, cveId: null },
      ],
    });
    const serialized = JSON.stringify(context);
    expect(serialized).toContain('scan-1');
    expect(serialized).not.toMatch(/docker|container id|network/i);
  });
});