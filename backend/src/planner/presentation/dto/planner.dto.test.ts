import { describe, expect, it } from 'vitest';
import { toPlanResponse, type PlanResponse } from './planner.dto';

describe('planner.dto', () => {
  it('serializes planned targets into the API response shape', () => {
    const response = toPlanResponse({
      id: 'plan-1',
      scanId: 'scan-1',
      targets: [
        {
          targetId: 't-1',
          endpoint: '/api/search',
          method: 'POST',
          candidateVulnerabilities: ['SQL Injection'],
          priority: 85,
          recommendedTool: 'sqlmap',
          reason: 'priority 85',
          requiresAuthentication: false,
          estimatedRisk: 'HIGH',
          breakdown: [{ label: 'risk', points: 20 }],
        },
      ],
    } as any);

    expect(response).toMatchObject<PlanResponse>({
      planId: 'plan-1',
      scanId: 'scan-1',
      status: 'READY',
      targets: [
        {
          targetId: 't-1',
          endpoint: '/api/search',
          method: 'POST',
          candidateVulnerabilities: ['SQL Injection'],
          priority: 85,
          recommendedTool: 'sqlmap',
          reason: 'priority 85',
          requiresAuthentication: false,
          estimatedRisk: 'HIGH',
          breakdown: [{ label: 'risk', points: 20 }],
        },
      ],
    });
  });
});
