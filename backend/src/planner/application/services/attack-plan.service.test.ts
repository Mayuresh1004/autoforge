import { describe, expect, it } from 'vitest';
import { AttackPlanService } from './attack-plan.service';
import { PlanEngine } from '../ranking/plan-engine';
import { MemoryPlanRepository } from '../../../../test/helpers/plan-repository-memory';
import { ScanNotFoundError, PlanNotFoundError } from '../../domain/errors/planner.errors';

const PROFILE = { language: 'javascript', framework: 'Express', technologies: ['Express'] };

const CRITICAL_SURFACE = {
  url: 'http://app.test/api/login',
  method: 'POST',
  parameters: ['user', 'pass'],
  authentication: true,
  risk: 'CRITICAL',
  source: 'crawler',
  statusCode: 200,
};

const STATIC_SURFACE = {
  url: 'http://app.test/static/app.css',
  method: 'GET',
  parameters: [],
  authentication: false,
  risk: 'LOW',
  source: 'crawler',
  statusCode: 200,
};

const FINDINGS = [
  { type: 'B608', severity: 'HIGH', cwe: 'CWE-89', cve: null, confidence: 0.9, message: 'SQLi' },
];

function makeService(repo: MemoryPlanRepository): AttackPlanService {
  return new AttackPlanService({ repository: repo, engine: new PlanEngine() });
}

describe('AttackPlanService', () => {
  it('generate() loads inputs, reasons and persists a ranked plan', async () => {
    const repo = new MemoryPlanRepository();
    repo.seedScan('scan-1');
    repo.seedFindings('scan-1', FINDINGS);
    repo.seedSurfaces('scan-1', [CRITICAL_SURFACE, STATIC_SURFACE]);
    repo.seedProfile('scan-1', PROFILE);

    const plan = await makeService(repo).generate('scan-1');

    expect(plan.scanId).toBe('scan-1');
    expect(plan.targets).toHaveLength(2);
    expect(plan.targets[0].endpoint).toContain('/api/login');
    expect(plan.targets[0].candidateVulnerabilities).toContain('SQL Injection');
    expect(plan.targets[1].estimatedRisk).toBe('LOW');
    expect(plan.summary.targets).toBe(2);

    const fetched = await makeService(repo).getPlan(plan.id);
    expect(fetched.targets).toHaveLength(2);
  });

  it('generate() throws ScanNotFoundError for an unknown scan', async () => {
    const repo = new MemoryPlanRepository();
    await expect(makeService(repo).generate('nope')).rejects.toBeInstanceOf(ScanNotFoundError);
  });

  it('generate() yields an empty plan for a scan with no recon (never throws)', async () => {
    const repo = new MemoryPlanRepository();
    repo.seedScan('scan-empty');
    const plan = await makeService(repo).generate('scan-empty');
    expect(plan.targets).toHaveLength(0);
    expect(plan.summary.targets).toBe(0);
  });

  it('plan() is pure: reasoning composes with no repository touch', async () => {
    const repo = new MemoryPlanRepository();
    const plan = await makeService(repo).plan({
      scanId: 'pure',
      staticFindings: FINDINGS,
      attackSurface: [CRITICAL_SURFACE, STATIC_SURFACE],
      profile: PROFILE,
    });
    expect(plan.targets).toHaveLength(2);
    expect(await repo.getPlanForScan('pure')).toBeNull();
  });

  it('getPlanForScan returns the latest plan or null', async () => {
    const repo = new MemoryPlanRepository();
    repo.seedScan('scan-2');
    repo.seedSurfaces('scan-2', [CRITICAL_SURFACE]);
    repo.seedProfile('scan-2', PROFILE);
    const service = makeService(repo);
    const plan = await service.generate('scan-2');
    expect((await service.getPlanForScan('scan-2'))?.id).toBe(plan.id);
    expect(await service.getPlanForScan('missing')).toBeNull();
  });

  it('getPlan throws PlanNotFoundError when absent', async () => {
    await expect(makeService(new MemoryPlanRepository()).getPlan('missing')).rejects.toBeInstanceOf(
      PlanNotFoundError,
    );
  });
});