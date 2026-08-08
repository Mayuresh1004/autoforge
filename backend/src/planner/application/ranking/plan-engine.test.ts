import { describe, expect, it } from 'vitest';
import { PlanEngine } from './plan-engine';
import type { PlanRequest, SurfaceInput } from '../../domain/models/plan-input';

const engine = new PlanEngine();

const NO_PROFILE = { language: null, framework: null, technologies: [] };

function surface(partial: Partial<SurfaceInput>): SurfaceInput {
  return {
    url: 'http://app.test/api/login',
    method: 'POST',
    parameters: ['user'],
    authentication: true,
    risk: 'HIGH',
    source: 'crawler',
    statusCode: 200,
    ...partial,
  };
}

function req(surfaces: SurfaceInput[]): PlanRequest {
  return { scanId: 'scan-1', staticFindings: [], attackSurface: surfaces, profile: NO_PROFILE };
}

describe('PlanEngine', () => {
  it('sorts targets highest-priority first', () => {
    const plan = engine.build('plan-1', req([
      // Spec example: /api/search POST with params → MEDIUM-class surface.
      surface({ url: 'http://app.test/api/search', method: 'POST', risk: 'MEDIUM' }),
      surface({ url: 'http://app.test/health', method: 'GET', risk: 'LOW', authentication: false, parameters: [] }),
      // Admin panel should outrank everything.
      surface({ url: 'http://app.test/admin', method: 'GET', risk: 'HIGH' }),
    ]));

    const urls = plan.targets.map((t) => t.endpoint);
    expect(urls[0]).toContain('/admin');
    expect(plan.targets[0].priority).toBeGreaterThanOrEqual(plan.targets[1].priority);
    expect(plan.targets.every((t, i) => i === 0 || plan.targets[i - 1].priority >= t.priority)).toBe(true);

    const search = plan.targets.find((t) => t.endpoint.includes('/api/search'));
    expect(search?.candidateVulnerabilities).toContain('SQL Injection');
  });

  it('each target is a complete, explained PlannedTarget', () => {
    const plan = engine.build('plan-2', req([
      surface({ url: 'http://app.test/api/login' }),
      surface({ url: 'http://app.test/upload', authentication: true, risk: 'MEDIUM' }),
    ]));

    for (const t of plan.targets) {
      expect(t.targetId).toBeTruthy();
      expect(t.endpoint).toBeTruthy();
      expect(t.priority).toBeGreaterThanOrEqual(0);
      expect(t.priority).toBeLessThanOrEqual(100);
      expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(t.estimatedRisk);
      expect(t.reason).toContain('priority ' + t.priority + '/100');
      expect(t.reason).toContain('(+');
      expect(t.breakdown.length).toBeGreaterThan(0);
      expect(t.recommendedTool).toBeTruthy();
    }
    // Upload + auth is CRITICAL by rule.
    const upload = plan.targets.find((t) => t.endpoint.includes('/upload'));
    expect(upload?.estimatedRisk).toBe('CRITICAL');
  });

  it('summarizes risk buckets', () => {
    const plan = engine.build(
      'plan-3',
      req([
        surface({ url: 'http://a.test/admin', risk: 'HIGH' }),
        surface({ url: 'http://a.test/api/search', method: 'POST', risk: 'MEDIUM' }),
        surface({ url: 'http://a.test/health', risk: 'LOW', authentication: false, parameters: [] }),
      ]),
    );
    expect(plan.summary.targets).toBe(3);
    expect(plan.summary.critical + plan.summary.high + plan.summary.medium + plan.summary.low).toBe(3);
  });

  it('empty surface yields an empty (valid) plan', () => {
    const plan = engine.build('plan-4', req([]));
    expect(plan.targets).toHaveLength(0);
    expect(plan.summary.targets).toBe(0);
    expect(plan.id).toBe('plan-4');
  });
});