import { describe, expect, it } from 'vitest';
import { DemoRunner } from './demoRunner';
import { ASKBIT_FIXTURE, GEOSPY_FIXTURE, WEBGOAT_FIXTURE } from './fixtures';
import { smartAMASSDataProvider } from '../providers';
import type { AmassEvent } from '../types/amass-events';

describe('DemoRunner - AMASS Security Pipeline Simulation', () => {
  it('emits full phase-gated event stream for AskBit target fixture', async () => {
    const emittedEvents: AmassEvent[] = [];
    const phasesObserved = new Set<string>();

    await new Promise<void>((resolve) => {
      const runner = new DemoRunner({
        fixture: ASKBIT_FIXTURE,
        scenarioId: 'full_approved',
        speedMultiplier: 100.0,
        onEvent: (evt) => {
          emittedEvents.push(evt);
          phasesObserved.add(evt.phase);
          if (evt.eventType === 'SCAN_COMPLETED') {
            resolve();
          }
        },
      });

      runner.start();
    });

    expect(emittedEvents.length).toBeGreaterThan(15);
    expect(phasesObserved.has('scan')).toBe(true);
    expect(phasesObserved.has('analysis')).toBe(true);
    expect(phasesObserved.has('recon')).toBe(true);
    expect(phasesObserved.has('planning')).toBe(true);
    expect(phasesObserved.has('verification')).toBe(true);
    expect(phasesObserved.has('remediation')).toBe(true);
    expect(phasesObserved.has('validation')).toBe(true);

    const eventTypes = emittedEvents.map((e) => e.eventType);
    expect(eventTypes).toContain('SCAN_STARTED');
    expect(eventTypes).toContain('ANALYZER_STARTED');
    expect(eventTypes).toContain('SCOUT_STARTED');
    expect(eventTypes).toContain('PLANNER_STARTED');
    expect(eventTypes).toContain('SNIPER_STARTED');
    expect(eventTypes).toContain('ENGINEER_STARTED');
    expect(eventTypes).toContain('CRITIC_STARTED');
    expect(eventTypes).toContain('CRITIC_APPROVED');
    expect(eventTypes).toContain('REMEDIATION_PR_CREATED');
    expect(eventTypes).toContain('SCAN_COMPLETED');
  });

  it('emits full phase-gated event stream for GeoSpy target fixture', async () => {
    const emittedEvents: AmassEvent[] = [];

    await new Promise<void>((resolve) => {
      const runner = new DemoRunner({
        fixture: GEOSPY_FIXTURE,
        scenarioId: 'full_approved',
        speedMultiplier: 100.0,
        onEvent: (evt) => {
          emittedEvents.push(evt);
          if (evt.eventType === 'SCAN_COMPLETED') resolve();
        },
      });

      runner.start();
    });

    const eventTypes = emittedEvents.map((e) => e.eventType);
    expect(eventTypes).toContain('SCAN_STARTED');
    expect(eventTypes).toContain('SCOUT_STARTED');
    expect(eventTypes).toContain('PLANNER_STARTED');
    expect(eventTypes).toContain('SNIPER_STARTED');
    expect(eventTypes).toContain('ENGINEER_STARTED');
    expect(eventTypes).toContain('CRITIC_STARTED');
    expect(eventTypes).toContain('CRITIC_APPROVED');
    expect(eventTypes).toContain('REMEDIATION_PR_CREATED');
    expect(eventTypes).toContain('SCAN_COMPLETED');

    const prEvents = emittedEvents.filter((e) => e.eventType === 'REMEDIATION_PR_CREATED');
    expect(prEvents.length).toBe(GEOSPY_FIXTURE.patches.length);
    prEvents.forEach((prEvt) => {
      const prUrl = prEvt.metadata?.prUrl as string;
      expect(prUrl).toContain('geospy');
    });
  });

  it('emits full phase-gated event stream for WebGoat target fixture through Scout -> Planner -> Sniper -> Engineer -> Critic', async () => {
    const emittedEvents: AmassEvent[] = [];
    const phasesObserved = new Set<string>();

    await new Promise<void>((resolve) => {
      const runner = new DemoRunner({
        fixture: WEBGOAT_FIXTURE,
        scenarioId: 'full_approved',
        speedMultiplier: 100.0,
        onEvent: (evt) => {
          emittedEvents.push(evt);
          phasesObserved.add(evt.phase);
          if (evt.eventType === 'SCAN_COMPLETED') resolve();
        },
      });

      runner.start();
    });

    expect(phasesObserved.has('scan')).toBe(true);
    expect(phasesObserved.has('analysis')).toBe(true);
    expect(phasesObserved.has('recon')).toBe(true);
    expect(phasesObserved.has('planning')).toBe(true);
    expect(phasesObserved.has('verification')).toBe(true);
    expect(phasesObserved.has('remediation')).toBe(true);
    expect(phasesObserved.has('validation')).toBe(true);

    const eventTypes = emittedEvents.map((e) => e.eventType);
    expect(eventTypes).toContain('SCAN_STARTED');
    expect(eventTypes).toContain('ANALYZER_STARTED');
    expect(eventTypes).toContain('SCANNER_FINDING_DISCOVERED');
    expect(eventTypes).toContain('SANDBOX_PROVISIONING');
    expect(eventTypes).toContain('SANDBOX_READY');
    expect(eventTypes).toContain('SCOUT_STARTED');
    expect(eventTypes).toContain('SCOUT_ENDPOINT_DISCOVERED');
    expect(eventTypes).toContain('PLANNER_STARTED');
    expect(eventTypes).toContain('PLANNER_COMPLETED');
    expect(eventTypes).toContain('SNIPER_STARTED');
    expect(eventTypes).toContain('SNIPER_CONFIRMED');
    expect(eventTypes).toContain('ENGINEER_STARTED');
    expect(eventTypes).toContain('ENGINEER_PATCH_GENERATED');
    expect(eventTypes).toContain('CRITIC_STARTED');
    expect(eventTypes).toContain('BASELINE_CHECK_STARTED');
    expect(eventTypes).toContain('BASELINE_CHECK_COMPLETED');
    expect(eventTypes).toContain('PATCH_APPLY_STARTED');
    expect(eventTypes).toContain('PATCH_APPLIED');
    expect(eventTypes).toContain('BUILD_COMPLETED');
    expect(eventTypes).toContain('TESTS_COMPLETED');
    expect(eventTypes).toContain('EXPLOIT_RETEST_COMPLETED');
    expect(eventTypes).toContain('CRITIC_APPROVED');
    expect(eventTypes).toContain('REMEDIATION_PR_CREATED');
    expect(eventTypes).toContain('CRITIC_COMPLETED');
    expect(eventTypes).toContain('SCAN_COMPLETED');

    // Verify real GitHub PR delivery for WebGoat on Mayuresh1004/WebGoat
    const prEvents = emittedEvents.filter((e) => e.eventType === 'REMEDIATION_PR_CREATED');
    expect(prEvents.length).toBe(WEBGOAT_FIXTURE.patches.length);
    prEvents.forEach((prEvt) => {
      expect(prEvt.metadata?.prUrl).toMatch(/^https:\/\/github\.com\/Mayuresh1004\/WebGoat\/pull\/[12]$/);
      expect(prEvt.metadata?.isSimulated).toBe(false);
      expect(prEvt.message).toContain('GitHub Pull Request');
      expect(prEvt.metadata?.prUrl).not.toBe('https://github.com/WebGoat/WebGoat/pull/102');
      expect(prEvt.metadata?.prUrl).not.toBe('https://github.com/WebGoat/WebGoat/pull/101');
    });
  });

  it('preserves stable finding and target identifiers across every pipeline stage for WebGoat', async () => {
    const emittedEvents: AmassEvent[] = [];

    await new Promise<void>((resolve) => {
      const runner = new DemoRunner({
        fixture: WEBGOAT_FIXTURE,
        scenarioId: 'full_approved',
        speedMultiplier: 100.0,
        onEvent: (evt) => {
          emittedEvents.push(evt);
          if (evt.eventType === 'SCAN_COMPLETED') resolve();
        },
      });

      runner.start();
    });

    const targetFindingId = 'fnd-webgoat-sqli';

    // 1. Scanner discovery
    const scannerEvt = emittedEvents.find(
      (e) => e.eventType === 'SCANNER_FINDING_DISCOVERED' && e.metadata?.findingId === targetFindingId
    );
    expect(scannerEvt).toBeDefined();

    // 2. Scout recon
    const scoutEvt = emittedEvents.find(
      (e) => e.eventType === 'SCOUT_ENDPOINT_DISCOVERED' && e.metadata?.findingId === targetFindingId
    );
    expect(scoutEvt).toBeDefined();
    expect(scoutEvt?.metadata?.endpoint).toBe('/WebGoat/SqlInjection/assignment5a');

    // 3. Planner
    const plannerEvt = emittedEvents.find(
      (e) => e.eventType === 'PLANNER_COMPLETED' && e.metadata?.findingId === targetFindingId
    );
    expect(plannerEvt).toBeDefined();

    // 4. Sniper
    const sniperEvt = emittedEvents.find(
      (e) => e.eventType === 'SNIPER_CONFIRMED' && e.metadata?.findingId === targetFindingId
    );
    expect(sniperEvt).toBeDefined();

    // 5. Engineer
    const engineerEvt = emittedEvents.find(
      (e) => e.eventType === 'ENGINEER_PATCH_GENERATED' && e.metadata?.findingId === targetFindingId
    );
    expect(engineerEvt).toBeDefined();
    expect(engineerEvt?.metadata?.filePath).toBe('src/main/java/org/owasp/webgoat/lessons/sqlinjection/introduction/SqlInjectionLesson5a.java');

    // 6. Critic
    const criticEvt = emittedEvents.find(
      (e) => e.eventType === 'CRITIC_APPROVED' && e.metadata?.findingId === targetFindingId
    );
    expect(criticEvt).toBeDefined();

    // 7. PR
    const prEvt = emittedEvents.find(
      (e) => e.eventType === 'REMEDIATION_PR_CREATED' && e.metadata?.findingId === targetFindingId
    );
    expect(prEvt).toBeDefined();
  });

  it('guarantees that a failed baseline check CANNOT produce a Critic approval', async () => {
    const emittedEvents: AmassEvent[] = [];

    await new Promise<void>((resolve) => {
      const runner = new DemoRunner({
        fixture: WEBGOAT_FIXTURE,
        scenarioId: 'baseline_failed',
        speedMultiplier: 100.0,
        onEvent: (evt) => {
          emittedEvents.push(evt);
          if (evt.eventType === 'SCAN_FAILED' || evt.eventType === 'SCAN_COMPLETED') resolve();
        },
      });

      runner.start();
    });

    const failedBaselineEvt = emittedEvents.find(
      (e) => e.eventType === 'BASELINE_CHECK_COMPLETED' && e.status === 'FAILED'
    );
    expect(failedBaselineEvt).toBeDefined();
    expect(failedBaselineEvt?.status).toBe('FAILED');
    expect(failedBaselineEvt?.level).toBe('ERROR');

    const rejectedFindingId = failedBaselineEvt?.metadata?.findingId as string;
    expect(rejectedFindingId).toBeDefined();

    // Verify that the failed baseline finding NEVER produces CRITIC_APPROVED or REMEDIATION_PR_CREATED
    const approvedEvt = emittedEvents.find(
      (e) => e.eventType === 'CRITIC_APPROVED' && e.metadata?.findingId === rejectedFindingId
    );
    expect(approvedEvt).toBeUndefined();

    const prEvt = emittedEvents.find(
      (e) => e.eventType === 'REMEDIATION_PR_CREATED' && e.metadata?.findingId === rejectedFindingId
    );
    expect(prEvt).toBeUndefined();

    // Verify that CRITIC_REJECTED was emitted for the failed baseline
    const rejectedEvt = emittedEvents.find(
      (e) => e.eventType === 'CRITIC_REJECTED' && e.metadata?.findingId === rejectedFindingId
    );
    expect(rejectedEvt).toBeDefined();
    expect(rejectedEvt?.status).toBe('REJECTED');
  });

  it('routes WebGoat repository URLs correctly via smartAMASSDataProvider', async () => {
    const res = await smartAMASSDataProvider.startScan({
      repositoryUrl: 'https://github.com/WebGoat/WebGoat',
    });

    expect(res.success).toBe(true);
    expect(res.data?.scanId).toBe(WEBGOAT_FIXTURE.scan.scanId);
    expect(res.data?.repositoryUrl).toBe(WEBGOAT_FIXTURE.repositoryUrl);
  });

  it('guarantees that WebGoat demo delivers real GitHub PRs on Mayuresh1004/WebGoat and never links to unrelated upstream PR #102', async () => {
    const emittedEvents: AmassEvent[] = [];

    await new Promise<void>((resolve) => {
      const runner = new DemoRunner({
        fixture: WEBGOAT_FIXTURE,
        scenarioId: 'full_approved',
        speedMultiplier: 100.0,
        onEvent: (evt) => {
          emittedEvents.push(evt);
          if (evt.eventType === 'SCAN_COMPLETED') resolve();
        },
      });

      runner.start();
    });

    const prEvents = emittedEvents.filter((e) => e.eventType === 'REMEDIATION_PR_CREATED');
    expect(prEvents.length).toBe(WEBGOAT_FIXTURE.patches.length);

    for (const evt of prEvents) {
      // Must not link to unrelated upstream PRs
      expect(evt.metadata?.prUrl).not.toBe('https://github.com/WebGoat/WebGoat/pull/102');
      expect(evt.metadata?.prUrl).not.toBe('https://github.com/WebGoat/WebGoat/pull/101');
      expect(evt.metadata?.prUrl).toMatch(/^https:\/\/github\.com\/Mayuresh1004\/WebGoat\/pull\/[12]$/);
      expect(evt.metadata?.isSimulated).toBe(false);

      // Must explicitly report real GitHub PR creation with HTML URL
      expect(evt.message).toMatch(/GitHub Pull Request #\d+ created: https:\/\/github\.com\/Mayuresh1004\/WebGoat\/pull\/\d+/);

      // Preserve scan, finding, and patch relationships
      expect(evt.scanId).toBe(WEBGOAT_FIXTURE.scan.scanId);
      expect(evt.metadata?.findingId).toBeDefined();
      expect(evt.metadata?.patchId).toBeDefined();
    }
  });
});

