/**
 * AMASS Event Stream Simulation Engine (Phase 10A).
 * 
 * Emits strictly monotonic Phase 9 AmassEvents into the frontend state reducer.
 * Emits progressive SCANNER_FINDING_DISCOVERED events to reveal findings one-by-one.
 * Emits finding-aware SCOUT recon events for each discovered vulnerability.
 */

import type { AmassEvent } from '../types/amass-events';
import type { DemoTargetFixture } from './fixtures';
import type { DemoScenarioId } from '../providers/types';

export interface DemoRunnerConfig {
  fixture: DemoTargetFixture;
  scenarioId: DemoScenarioId;
  speedMultiplier?: number;
  onEvent: (event: AmassEvent) => void;
  onStateUpdate?: (phase: string) => void;
}

export class DemoRunner {
  private config: DemoRunnerConfig;
  private sequence = 0;
  private timerIds: number[] = [];
  private isStopped = false;

  constructor(config: DemoRunnerConfig) {
    this.config = config;
  }

  public start() {
    this.stop();
    this.isStopped = false;
    this.sequence = 0;

    const baseSpeed = this.config.speedMultiplier && this.config.speedMultiplier > 0
      ? this.config.speedMultiplier
      : 1.0;

    // Helper to calculate delay in ms scaled by speed multiplier
    const delay = (seconds: number) => Math.max(100, Math.floor((seconds * 1000) / baseSpeed));

    const eventsToSchedule: Array<{ delaySec: number; event: Omit<AmassEvent, 'eventId' | 'sequence' | 'timestamp'> }> = [];

    const scanId = this.config.fixture.scan.scanId;

    // 1. SCAN_STARTED
    eventsToSchedule.push({
      delaySec: 0.5,
      event: {
        scanId,
        eventType: 'SCAN_STARTED',
        agentType: 'SYSTEM',
        phase: 'scan',
        level: 'INFO',
        status: 'STARTED',
        message: `Scan initiated for target repository ${this.config.fixture.name}`,
        metadata: { targetUrl: this.config.fixture.scan.targetUrl },
      },
    });

    // 2. ANALYZER
    eventsToSchedule.push({
      delaySec: 3.0,
      event: {
        scanId,
        eventType: 'ANALYZER_STARTED',
        agentType: 'ANALYZER',
        phase: 'analysis',
        level: 'INFO',
        status: 'STARTED',
        message: `Analyzer inspecting repository structure: ${this.config.fixture.techStack}`,
      },
    });
    eventsToSchedule.push({
      delaySec: 9.0,
      event: {
        scanId,
        eventType: 'ANALYZER_COMPLETED',
        agentType: 'ANALYZER',
        phase: 'analysis',
        level: 'INFO',
        status: 'COMPLETED',
        message: `Analyzer completed structure parsing. Detected tech stack: ${this.config.fixture.techStack}`,
      },
    });

    // 3. SCANNER (Progressive Vulnerability Discovery)
    eventsToSchedule.push({
      delaySec: 12.0,
      event: {
        scanId,
        eventType: 'SCANNER_STARTED',
        agentType: 'SCANNER',
        phase: 'scanning',
        level: 'INFO',
        status: 'STARTED',
        message: 'Static Vulnerability Scanner analyzing source code against OWASP Top 10 rules',
      },
    });

    // Emit findings PROGRESSIVELY one-by-one
    this.config.fixture.findings.forEach((finding, idx) => {
      eventsToSchedule.push({
        delaySec: 14.0 + idx * 2.0,
        event: {
          scanId,
          eventType: 'SCANNER_FINDING_DISCOVERED',
          agentType: 'SCANNER',
          phase: 'scanning',
          level: finding.severity === 'CRITICAL' || finding.severity === 'HIGH' ? 'WARN' : 'INFO',
          status: 'IN_PROGRESS',
          message: `Discovered candidate vulnerability: ${finding.title} (${finding.cwe}) in ${finding.filePath}:${finding.lineStart}`,
          metadata: {
            finding: {
              ...finding,
              findingId: finding.id,
              status: 'DISCOVERED',
              isConfirmed: false,
            },
            findingId: finding.id,
          },
        },
      });
    });

    const scannerDoneTime = 14.0 + this.config.fixture.findings.length * 2.0 + 2.0;
    eventsToSchedule.push({
      delaySec: scannerDoneTime,
      event: {
        scanId,
        eventType: 'SCANNER_COMPLETED',
        agentType: 'SCANNER',
        phase: 'scanning',
        level: 'INFO',
        status: 'COMPLETED',
        message: `Static Scanner completed execution. Identified ${this.config.fixture.findings.length} candidate vulnerabilities across OWASP Top 10 categories.`,
        metadata: { counts: { total: this.config.fixture.findings.length } },
      },
    });

    // 4. SANDBOX LIFECYCLE
    const sandboxStartTime = scannerDoneTime + 3.0;
    eventsToSchedule.push({
      delaySec: sandboxStartTime,
      event: {
        scanId,
        eventType: 'SANDBOX_PROVISIONING',
        agentType: 'SANDBOX',
        phase: 'sandbox',
        level: 'INFO',
        status: 'STARTED',
        message: 'Provisioning isolated Docker runtime container environment',
        metadata: { sandboxId: this.config.fixture.sandbox.sandboxId, runtime: 'docker-isolated' },
      },
    });
    eventsToSchedule.push({
      delaySec: sandboxStartTime + 8.0,
      event: {
        scanId,
        eventType: 'SANDBOX_READY',
        agentType: 'SANDBOX',
        phase: 'sandbox',
        level: 'INFO',
        status: 'READY',
        message: `Runtime Sandbox ready at ${this.config.fixture.sandbox.targetUrl}`,
        metadata: { sandboxId: this.config.fixture.sandbox.sandboxId, targetUrl: this.config.fixture.sandbox.targetUrl },
      },
    });

    // 5. FINDING-AWARE SCOUT RECON
    const scoutStartTime = sandboxStartTime + 11.0;
    eventsToSchedule.push({
      delaySec: scoutStartTime,
      event: {
        scanId,
        eventType: 'SCOUT_STARTED',
        agentType: 'SCOUT',
        phase: 'recon',
        level: 'INFO',
        status: 'STARTED',
        message: 'Scout Recon agent probing runtime attack surface and finding-aware endpoints in sandbox',
      },
    });

    // For every discovered finding, execute a finding-aware Scout recon lifecycle
    this.config.fixture.findings.forEach((finding, idx) => {
      const fTime = scoutStartTime + 2.0 + idx * 7.0;
      const scoutEp = this.config.fixture.endpoints.find((ep) => ep.findingId === finding.id || ep.path === finding.endpoint) ?? {
        findingId: finding.id,
        path: finding.endpoint || `/api/target-${idx}`,
        method: 'GET',
        description: `Endpoint for ${finding.title}`,
        evidence: `Identified route handler in ${finding.filePath}`,
      };

      // 5a. SCOUT_TARGET_STARTED
      eventsToSchedule.push({
        delaySec: fTime + 0.0,
        event: {
          scanId,
          eventType: 'SCOUT_TARGET_STARTED',
          agentType: 'SCOUT',
          phase: 'recon',
          level: 'INFO',
          status: 'IN_PROGRESS',
          message: `Scout investigating attack surface for ${finding.id} (${finding.title})`,
          metadata: {
            findingId: finding.id,
            vulnerabilityId: finding.id,
            title: finding.title,
            filePath: finding.filePath,
          },
        },
      });

      // 5b. SCOUT_ENDPOINT_DISCOVERED
      eventsToSchedule.push({
        delaySec: fTime + 2.0,
        event: {
          scanId,
          eventType: 'SCOUT_ENDPOINT_DISCOVERED',
          agentType: 'SCOUT',
          phase: 'recon',
          level: 'INFO',
          status: 'IN_PROGRESS',
          message: `Discovered endpoint ${scoutEp.method} ${scoutEp.path} mapped to finding ${finding.id}`,
          metadata: {
            findingId: finding.id,
            endpoint: scoutEp.path,
            method: scoutEp.method,
            description: scoutEp.description,
          },
        },
      });

      // 5c. SCOUT_EVIDENCE_COLLECTED
      eventsToSchedule.push({
        delaySec: fTime + 4.0,
        event: {
          scanId,
          eventType: 'SCOUT_EVIDENCE_COLLECTED',
          agentType: 'SCOUT',
          phase: 'recon',
          level: 'INFO',
          status: 'IN_PROGRESS',
          message: `Recon evidence collected for ${finding.id}: ${scoutEp.evidence}`,
          metadata: {
            findingId: finding.id,
            endpoint: scoutEp.path,
            evidence: scoutEp.evidence,
          },
        },
      });

      // 5d. SCOUT_TARGET_COMPLETED
      eventsToSchedule.push({
        delaySec: fTime + 6.0,
        event: {
          scanId,
          eventType: 'SCOUT_TARGET_COMPLETED',
          agentType: 'SCOUT',
          phase: 'recon',
          level: 'INFO',
          status: 'COMPLETED',
          message: `Scout reconnaissance complete for finding ${finding.id}`,
          metadata: {
            findingId: finding.id,
          },
        },
      });
    });

    const scoutDoneTime = scoutStartTime + 2.0 + this.config.fixture.findings.length * 7.0 + 2.0;
    eventsToSchedule.push({
      delaySec: scoutDoneTime,
      event: {
        scanId,
        eventType: 'SCOUT_COMPLETED',
        agentType: 'SCOUT',
        phase: 'recon',
        level: 'INFO',
        status: 'COMPLETED',
        message: `Scout Recon completed across all ${this.config.fixture.findings.length} discovered findings.`,
      },
    });

    // 6. ATTACK PLANNER (Consumes Scout Results)
    const plannerStartTime = scoutDoneTime + 3.0;
    eventsToSchedule.push({
      delaySec: plannerStartTime,
      event: {
        scanId,
        eventType: 'PLANNER_STARTED',
        agentType: 'PLANNER',
        phase: 'planning',
        level: 'INFO',
        status: 'STARTED',
        message: 'Planner combining static findings and Scout recon evidence into prioritized attack targets',
      },
    });
    eventsToSchedule.push({
      delaySec: plannerStartTime + 8.0,
      event: {
        scanId,
        eventType: 'PLANNER_COMPLETED',
        agentType: 'PLANNER',
        phase: 'planning',
        level: 'INFO',
        status: 'COMPLETED',
        message: `Planner finalized execution plan with ${this.config.fixture.targets.length} high-priority targets.`,
        metadata: { targets: this.config.fixture.targets },
      },
    });

    // 7. SNIPER EXPLOITATION (Linked via findingId)
    const sniperStartTime = plannerStartTime + 11.0;
    eventsToSchedule.push({
      delaySec: sniperStartTime,
      event: {
        scanId,
        eventType: 'SNIPER_STARTED',
        agentType: 'SNIPER',
        phase: 'verification',
        level: 'INFO',
        status: 'STARTED',
        message: 'Sniper Agent verifying target vulnerabilities in runtime sandbox environment',
      },
    });

    this.config.fixture.exploits.forEach((exp, idx) => {
      const fId = exp.findingId || exp.targetId;
      eventsToSchedule.push({
        delaySec: sniperStartTime + 3.0 + idx * 7.0,
        event: {
          scanId,
          eventType: 'SNIPER_TARGET_SELECTED',
          agentType: 'SNIPER',
          phase: 'verification',
          level: 'INFO',
          status: 'IN_PROGRESS',
          message: `Target selected for verification: ${exp.endpoint} (${fId})`,
          metadata: { targetId: exp.targetId, findingId: fId, endpoint: exp.endpoint, vulnerabilityId: fId },
        },
      });
      eventsToSchedule.push({
        delaySec: sniperStartTime + 7.0 + idx * 7.0,
        event: {
          scanId,
          eventType: 'SNIPER_CONFIRMED',
          agentType: 'SNIPER',
          phase: 'verification',
          level: 'WARN',
          status: 'CONFIRMED',
          message: exp.verificationNotes || `Vulnerability confirmed at ${exp.endpoint}`,
          metadata: { targetId: exp.targetId, findingId: fId, endpoint: exp.endpoint, vulnerabilityId: fId },
        },
      });
    });

    const sniperDoneTime = sniperStartTime + 7.0 + this.config.fixture.exploits.length * 7.0 + 2.0;
    eventsToSchedule.push({
      delaySec: sniperDoneTime,
      event: {
        scanId,
        eventType: 'SNIPER_VERIFICATION_COMPLETED',
        agentType: 'SNIPER',
        phase: 'verification',
        level: 'INFO',
        status: 'COMPLETED',
        message: `Sniper verification complete. Confirmed ${this.config.fixture.exploits.length} exploitable vulnerabilities.`,
      },
    });

    // 8. ENGINEER REMEDIATION
    const engineerStartTime = sniperDoneTime + 3.0;
    eventsToSchedule.push({
      delaySec: engineerStartTime,
      event: {
        scanId,
        eventType: 'ENGINEER_STARTED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        level: 'INFO',
        status: 'STARTED',
        message: 'Engineer Agent generating remediation patch using RAG context and source code inspection',
      },
    });
    eventsToSchedule.push({
      delaySec: engineerStartTime + 4.0,
      event: {
        scanId,
        eventType: 'ENGINEER_RAG_STARTED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        level: 'INFO',
        status: 'IN_PROGRESS',
        message: 'Querying vector RAG index for OWASP mitigation guidelines and repository code patterns',
      },
    });
    eventsToSchedule.push({
      delaySec: engineerStartTime + 8.0,
      event: {
        scanId,
        eventType: 'ENGINEER_LLM_STARTED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        level: 'INFO',
        status: 'IN_PROGRESS',
        message: 'Generating minimal defensive code patch for primary target',
      },
    });

    const primaryPatch = this.config.fixture.patches[0];
    const primaryFindingId = primaryPatch?.findingId || this.config.fixture.findings[0]?.id;
    eventsToSchedule.push({
      delaySec: engineerStartTime + 15.0,
      event: {
        scanId,
        eventType: 'ENGINEER_PATCH_GENERATED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        level: 'INFO',
        status: 'COMPLETED',
        message: primaryPatch?.diffContent || 'Remediation patch generated cleanly.',
        metadata: {
          patchId: primaryPatch?.patchId || 'patch-001',
          findingId: primaryFindingId,
          filePath: primaryPatch?.filePath || 'src/vulnerable.ts',
        },
      },
    });

    // 9. CRITIC QUALITY ASSURANCE MATRIX
    const criticStartTime = engineerStartTime + 18.0;
    const isRejectedScenario = this.config.scenarioId === 'critic_rejected';

    eventsToSchedule.push({
      delaySec: criticStartTime,
      event: {
        scanId,
        eventType: 'CRITIC_STARTED',
        agentType: 'CRITIC',
        phase: 'validation',
        level: 'INFO',
        status: 'STARTED',
        message: 'Critic Agent initiating 6-stage validation pipeline on generated patch',
        metadata: { findingId: primaryFindingId },
      },
    });

    // Baseline check
    eventsToSchedule.push({
      delaySec: criticStartTime + 3.0,
      event: {
        scanId,
        eventType: 'BASELINE_CHECK_STARTED',
        agentType: 'CRITIC',
        phase: 'validation',
        level: 'INFO',
        status: 'IN_PROGRESS',
        message: 'Baseline Check: Confirming vulnerable state before patch application',
      },
    });
    eventsToSchedule.push({
      delaySec: criticStartTime + 6.0,
      event: {
        scanId,
        eventType: 'BASELINE_CHECK_COMPLETED',
        agentType: 'CRITIC',
        phase: 'validation',
        level: 'INFO',
        status: 'COMPLETED',
        message: 'Baseline Check ✓: Vulnerable behavior successfully reproduced in sandbox',
      },
    });

    // Patch apply
    eventsToSchedule.push({
      delaySec: criticStartTime + 9.0,
      event: {
        scanId,
        eventType: 'PATCH_APPLY_STARTED',
        agentType: 'CRITIC',
        phase: 'validation',
        level: 'INFO',
        status: 'IN_PROGRESS',
        message: 'Patch Application: Applying diff to sandbox workspace',
      },
    });
    eventsToSchedule.push({
      delaySec: criticStartTime + 12.0,
      event: {
        scanId,
        eventType: 'PATCH_APPLIED',
        agentType: 'CRITIC',
        phase: 'validation',
        level: 'INFO',
        status: 'COMPLETED',
        message: 'Patch Application ✓: Patch applied cleanly without merge conflicts',
      },
    });

    // Build
    eventsToSchedule.push({
      delaySec: criticStartTime + 15.0,
      event: {
        scanId,
        eventType: 'BUILD_STARTED',
        agentType: 'CRITIC',
        phase: 'validation',
        level: 'INFO',
        status: 'IN_PROGRESS',
        message: 'Sandbox Build: Compiling application with patch applied',
      },
    });
    eventsToSchedule.push({
      delaySec: criticStartTime + 20.0,
      event: {
        scanId,
        eventType: 'BUILD_COMPLETED',
        agentType: 'CRITIC',
        phase: 'validation',
        level: 'INFO',
        status: 'COMPLETED',
        message: 'Sandbox Build ✓: Application compiled cleanly (0 errors)',
      },
    });

    // Tests
    eventsToSchedule.push({
      delaySec: criticStartTime + 23.0,
      event: {
        scanId,
        eventType: 'TESTS_STARTED',
        agentType: 'CRITIC',
        phase: 'validation',
        level: 'INFO',
        status: 'IN_PROGRESS',
        message: 'Test Suite: Executing existing test suite to prevent regression',
      },
    });
    eventsToSchedule.push({
      delaySec: criticStartTime + 28.0,
      event: {
        scanId,
        eventType: 'TESTS_COMPLETED',
        agentType: 'CRITIC',
        phase: 'validation',
        level: 'INFO',
        status: 'COMPLETED',
        message: 'Test Suite ✓: Existing unit test suite passed without regression',
      },
    });

    // Exploit Retest & Final Approval / Rejection
    eventsToSchedule.push({
      delaySec: criticStartTime + 31.0,
      event: {
        scanId,
        eventType: 'EXPLOIT_RETEST_STARTED',
        agentType: 'CRITIC',
        phase: 'validation',
        level: 'INFO',
        status: 'IN_PROGRESS',
        message: 'Exploit Retest: Re-executing Sniper payload against patched build',
      },
    });

    if (isRejectedScenario) {
      eventsToSchedule.push({
        delaySec: criticStartTime + 36.0,
        event: {
          scanId,
          eventType: 'CRITIC_REJECTED',
          agentType: 'CRITIC',
          phase: 'validation',
          level: 'ERROR',
          status: 'REJECTED',
          message: 'Critic REJECTED: Exploit still succeeds after patch application. Input filter bypass discovered.',
        },
      });
    } else {
      eventsToSchedule.push({
        delaySec: criticStartTime + 36.0,
        event: {
          scanId,
          eventType: 'EXPLOIT_RETEST_COMPLETED',
          agentType: 'CRITIC',
          phase: 'validation',
          level: 'INFO',
          status: 'COMPLETED',
          message: 'Exploit Retest ✓: Exploit payload no longer succeeds against patched sandbox',
        },
      });
      eventsToSchedule.push({
        delaySec: criticStartTime + 39.0,
        event: {
          scanId,
          eventType: 'CRITIC_APPROVED',
          agentType: 'CRITIC',
          phase: 'validation',
          level: 'INFO',
          status: 'COMPLETED',
          message: 'Critic APPROVED: Patch verified successfully across all quality gates',
          metadata: { findingId: primaryFindingId },
        },
      });
    }

    // 10. SCAN_COMPLETED
    const totalTime = criticStartTime + 42.0;
    eventsToSchedule.push({
      delaySec: totalTime,
      event: {
        scanId,
        eventType: isRejectedScenario ? 'SCAN_FAILED' : 'SCAN_COMPLETED',
        agentType: 'SYSTEM',
        phase: 'scan',
        level: isRejectedScenario ? 'WARN' : 'INFO',
        status: isRejectedScenario ? 'FAILED' : 'COMPLETED',
        message: isRejectedScenario
          ? 'Scan completed with Critic Rejection'
          : 'Scan completed successfully',
      },
    });

    // Schedule all events
    eventsToSchedule.forEach(({ delaySec, event }) => {
      const timerId = window.setTimeout(() => {
        if (this.isStopped) return;
        this.sequence += 1;
        const fullEvent: AmassEvent = {
          ...event,
          eventId: `evt_${this.sequence}_${Date.now()}`,
          sequence: this.sequence,
          timestamp: new Date().toISOString(),
        };
        this.config.onEvent(fullEvent);
      }, delay(delaySec));

      this.timerIds.push(timerId);
    });
  }

  public stop() {
    this.isStopped = true;
    this.timerIds.forEach((id) => window.clearTimeout(id));
    this.timerIds = [];
  }
}
