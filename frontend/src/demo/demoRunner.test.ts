import { describe, expect, it } from 'vitest';
import { DemoRunner } from './demoRunner';
import { ASKBIT_FIXTURE } from './fixtures';
import type { AmassEvent } from '../types/amass-events';

describe('DemoRunner - AskBit Security Pipeline Simulation', () => {
  it('emits full phase-gated event stream for AskBit target fixture', async () => {
    const emittedEvents: AmassEvent[] = [];
    const phasesObserved = new Set<string>();

    await new Promise<void>((resolve) => {
      const runner = new DemoRunner({
        fixture: ASKBIT_FIXTURE,
        scenarioId: 'full_approved',
        speedMultiplier: 100.0, // High speed for instant execution in tests
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
});
