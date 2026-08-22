/**
 * AMASS Event Stream Simulation Engine.
 * 
 * Emits strictly monotonic AmassEvents into the frontend state reducer.
 * Executes phase-gated execution across all discovered findings in target fixtures:
 * SCANNER → SCOUT → PLANNER → SNIPER → ENGINEER → CRITIC → FINAL VERDICT
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
    const findings = this.config.fixture.findings;
    const isRejectedScenario = this.config.scenarioId === 'critic_rejected';

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
      delaySec: 2.0,
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
      delaySec: 5.0,
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
      delaySec: 7.0,
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

    findings.forEach((finding, idx) => {
      eventsToSchedule.push({
        delaySec: 8.5 + idx * 1.5,
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

    const scannerDoneTime = 8.5 + findings.length * 1.5 + 1.0;
    eventsToSchedule.push({
      delaySec: scannerDoneTime,
      event: {
        scanId,
        eventType: 'SCANNER_COMPLETED',
        agentType: 'SCANNER',
        phase: 'scanning',
        level: 'INFO',
        status: 'COMPLETED',
        message: `Static Scanner completed execution. Identified ${findings.length} candidate vulnerabilities across OWASP Top 10 categories.`,
        metadata: { counts: { total: findings.length } },
      },
    });

    // 4. SANDBOX LIFECYCLE
    const sandboxStartTime = scannerDoneTime + 1.5;
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
      delaySec: sandboxStartTime + 3.0,
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
    const scoutStartTime = sandboxStartTime + 4.5;
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

    findings.forEach((finding, idx) => {
      const fTime = scoutStartTime + 1.0 + idx * 2.5;
      const scoutEp = this.config.fixture.endpoints.find((ep) => ep.findingId === finding.id || ep.path === finding.endpoint) ?? {
        findingId: finding.id,
        path: finding.endpoint || `/api/target-${idx}`,
        method: 'GET',
        description: `Endpoint for ${finding.title}`,
        evidence: `Identified route handler in ${finding.filePath}`,
      };

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

      eventsToSchedule.push({
        delaySec: fTime + 0.8,
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

      eventsToSchedule.push({
        delaySec: fTime + 1.6,
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

      eventsToSchedule.push({
        delaySec: fTime + 2.2,
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

    const scoutDoneTime = scoutStartTime + 1.0 + findings.length * 2.5 + 1.0;
    eventsToSchedule.push({
      delaySec: scoutDoneTime,
      event: {
        scanId,
        eventType: 'SCOUT_COMPLETED',
        agentType: 'SCOUT',
        phase: 'recon',
        level: 'INFO',
        status: 'COMPLETED',
        message: `Scout Recon completed across all ${findings.length} discovered findings.`,
      },
    });

    // 6. ATTACK PLANNER (Generates one plan per vulnerability)
    const plannerStartTime = scoutDoneTime + 1.5;
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

    this.config.fixture.targets.forEach((target, idx) => {
      const fId = target.findingId || target.targetId;
      eventsToSchedule.push({
        delaySec: plannerStartTime + 1.0 + idx * 1.5,
        event: {
          scanId,
          eventType: 'PLANNER_COMPLETED', // Emitted per target to reveal plans progressively
          agentType: 'PLANNER',
          phase: 'planning',
          level: 'INFO',
          status: 'IN_PROGRESS',
          message: `Planner finalized attack plan for ${target.vulnerabilityType} (${fId})`,
          metadata: {
            target: target as unknown as Record<string, unknown>,
            targetId: target.targetId,
            findingId: fId,
            endpoint: target.endpoint,
          },
        },
      });
    });

    const plannerDoneTime = plannerStartTime + 1.0 + this.config.fixture.targets.length * 1.5 + 1.0;
    eventsToSchedule.push({
      delaySec: plannerDoneTime,
      event: {
        scanId,
        eventType: 'PLANNER_COMPLETED',
        agentType: 'PLANNER',
        phase: 'planning',
        level: 'INFO',
        status: 'COMPLETED',
        message: `Planner finalized execution plans across all ${this.config.fixture.targets.length} targets.`,
        metadata: { total: this.config.fixture.targets.length },
      },
    });

    // 7. SNIPER EXPLOITATION (Verified per finding)
    const sniperStartTime = plannerDoneTime + 1.5;
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
      const sTime = sniperStartTime + 1.0 + idx * 2.5;

      eventsToSchedule.push({
        delaySec: sTime,
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
        delaySec: sTime + 1.5,
        event: {
          scanId,
          eventType: 'SNIPER_CONFIRMED',
          agentType: 'SNIPER',
          phase: 'verification',
          level: 'WARN',
          status: 'CONFIRMED',
          message: exp.verificationNotes || `Vulnerability confirmed at ${exp.endpoint}`,
          metadata: {
            targetId: exp.targetId,
            findingId: fId,
            endpoint: exp.endpoint,
            vulnerabilityId: fId,
            exploit: exp as unknown as Record<string, unknown>,
          },
        },
      });
    });

    const sniperDoneTime = sniperStartTime + 1.0 + this.config.fixture.exploits.length * 2.5 + 1.0;
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

    // 8. ENGINEER REMEDIATION (Generates patch per finding)
    const engineerStartTime = sniperDoneTime + 1.5;
    eventsToSchedule.push({
      delaySec: engineerStartTime,
      event: {
        scanId,
        eventType: 'ENGINEER_STARTED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        level: 'INFO',
        status: 'STARTED',
        message: 'Engineer Agent generating remediation patches using RAG context and source code inspection',
      },
    });

    this.config.fixture.patches.forEach((patch, idx) => {
      const fId = patch.findingId || findings[idx]?.id;
      const eTime = engineerStartTime + 1.0 + idx * 2.5;

      eventsToSchedule.push({
        delaySec: eTime,
        event: {
          scanId,
          eventType: 'ENGINEER_RAG_STARTED',
          agentType: 'ENGINEER',
          phase: 'remediation',
          level: 'INFO',
          status: 'IN_PROGRESS',
          message: `Querying vector RAG index for OWASP mitigation context for ${fId}`,
          metadata: { findingId: fId, patchId: patch.patchId },
        },
      });

      eventsToSchedule.push({
        delaySec: eTime + 1.5,
        event: {
          scanId,
          eventType: 'ENGINEER_PATCH_GENERATED',
          agentType: 'ENGINEER',
          phase: 'remediation',
          level: 'INFO',
          status: 'COMPLETED',
          message: patch.diffContent,
          metadata: {
            patchId: patch.patchId,
            findingId: fId,
            filePath: patch.filePath,
            explanation: patch.explanation,
            patch: patch as unknown as Record<string, unknown>,
          },
        },
      });
    });

    const engineerDoneTime = engineerStartTime + 1.0 + this.config.fixture.patches.length * 2.5 + 1.0;
    eventsToSchedule.push({
      delaySec: engineerDoneTime - 0.5,
      event: {
        scanId,
        eventType: 'ENGINEER_COMPLETED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        level: 'INFO',
        status: 'COMPLETED',
        message: `Engineer Agent completed remediation patch generation across all ${this.config.fixture.patches.length} targets.`,
        metadata: { total: this.config.fixture.patches.length },
      },
    });

    // 9. CRITIC QUALITY ASSURANCE MATRIX (Evaluates each finding's patch)
    const criticStartTime = engineerDoneTime + 1.5;
    eventsToSchedule.push({
      delaySec: criticStartTime,
      event: {
        scanId,
        eventType: 'CRITIC_STARTED',
        agentType: 'CRITIC',
        phase: 'validation',
        level: 'INFO',
        status: 'STARTED',
        message: 'Critic Agent initiating 6-stage validation pipeline on generated patches',
      },
    });

    this.config.fixture.patches.forEach((patch, idx) => {
      const fId = patch.findingId || findings[idx]?.id;
      const cTime = criticStartTime + 1.0 + idx * 4.0;
      // In rejected scenario, reject second finding (e.g. SQL Injection / fnd-askbit-a03 or fnd-geospy-a03)
      const isThisFindingRejected = isRejectedScenario && (fId.includes('a03') || idx === 1);

      // Baseline check
      eventsToSchedule.push({
        delaySec: cTime + 0.0,
        event: {
          scanId,
          eventType: 'BASELINE_CHECK_STARTED',
          agentType: 'CRITIC',
          phase: 'validation',
          level: 'INFO',
          status: 'IN_PROGRESS',
          message: `Baseline Check [${fId}]: Confirming vulnerable state before patch application`,
          metadata: { findingId: fId },
        },
      });
      eventsToSchedule.push({
        delaySec: cTime + 0.6,
        event: {
          scanId,
          eventType: 'BASELINE_CHECK_COMPLETED',
          agentType: 'CRITIC',
          phase: 'validation',
          level: 'INFO',
          status: 'COMPLETED',
          message: `Baseline Check ✓ [${fId}]: Vulnerable behavior reproduced in sandbox`,
          metadata: { findingId: fId },
        },
      });

      // Patch apply
      eventsToSchedule.push({
        delaySec: cTime + 1.2,
        event: {
          scanId,
          eventType: 'PATCH_APPLY_STARTED',
          agentType: 'CRITIC',
          phase: 'validation',
          level: 'INFO',
          status: 'IN_PROGRESS',
          message: `Patch Application [${fId}]: Applying diff to sandbox workspace`,
          metadata: { findingId: fId },
        },
      });
      eventsToSchedule.push({
        delaySec: cTime + 1.8,
        event: {
          scanId,
          eventType: 'PATCH_APPLIED',
          agentType: 'CRITIC',
          phase: 'validation',
          level: 'INFO',
          status: 'COMPLETED',
          message: `Patch Application ✓ [${fId}]: Patch applied cleanly without merge conflicts`,
          metadata: { findingId: fId },
        },
      });

      // Build & Tests
      eventsToSchedule.push({
        delaySec: cTime + 2.4,
        event: {
          scanId,
          eventType: 'BUILD_COMPLETED',
          agentType: 'CRITIC',
          phase: 'validation',
          level: 'INFO',
          status: 'COMPLETED',
          message: `Sandbox Build ✓ [${fId}]: Application compiled cleanly`,
          metadata: { findingId: fId },
        },
      });
      eventsToSchedule.push({
        delaySec: cTime + 3.0,
        event: {
          scanId,
          eventType: 'TESTS_COMPLETED',
          agentType: 'CRITIC',
          phase: 'validation',
          level: 'INFO',
          status: 'COMPLETED',
          message: `Test Suite ✓ [${fId}]: Test suite passed without regression`,
          metadata: { findingId: fId },
        },
      });

      // Exploit Retest & Final Approval / Rejection for this finding
      if (isThisFindingRejected) {
        eventsToSchedule.push({
          delaySec: cTime + 3.6,
          event: {
            scanId,
            eventType: 'CRITIC_REJECTED',
            agentType: 'CRITIC',
            phase: 'validation',
            level: 'ERROR',
            status: 'REJECTED',
            message: `Critic REJECTED [${fId}]: Exploit retest failed. Input filter bypass discovered in patch.`,
            metadata: { findingId: fId, patchId: patch.patchId },
          },
        });
      } else {
        eventsToSchedule.push({
          delaySec: cTime + 3.4,
          event: {
            scanId,
            eventType: 'EXPLOIT_RETEST_COMPLETED',
            agentType: 'CRITIC',
            phase: 'validation',
            level: 'INFO',
            status: 'COMPLETED',
            message: `Exploit Retest ✓ [${fId}]: Exploit payload no longer succeeds against patched sandbox`,
            metadata: { findingId: fId },
          },
        });
        eventsToSchedule.push({
          delaySec: cTime + 3.8,
          event: {
            scanId,
            eventType: 'CRITIC_APPROVED',
            agentType: 'CRITIC',
            phase: 'validation',
            level: 'INFO',
            status: 'COMPLETED',
            message: `Critic APPROVED [${fId}]: Patch verified successfully across all quality gates`,
            metadata: { findingId: fId, patchId: patch.patchId },
          },
        });
        eventsToSchedule.push({
          delaySec: cTime + 4.2,
          event: {
            scanId,
            eventType: 'REMEDIATION_PR_CREATED',
            agentType: 'SYSTEM',
            phase: 'remediation',
            level: 'INFO',
            status: 'SUCCEEDED',
            message: `PR #${patch.prNumber || 101} created: ${patch.prUrl || 'https://github.com/Mayuresh1004/owasp-vuln-lab/pull/101'}`,
            metadata: {
              findingId: fId,
              vulnerabilityId: fId,
              patchId: patch.patchId,
              prNumber: patch.prNumber || 101,
              prUrl: patch.prUrl || 'https://github.com/Mayuresh1004/owasp-vuln-lab/pull/101',
              prBranch: patch.prBranch || `amass/remediation/${patch.patchId}`,
              prStatus: patch.prStatus || 'OPEN',
            },
          },
        });
      }
    });

    const criticDoneTime = criticStartTime + 1.0 + this.config.fixture.patches.length * 4.0 + 1.0;
    eventsToSchedule.push({
      delaySec: criticDoneTime - 0.5,
      event: {
        scanId,
        eventType: 'CRITIC_COMPLETED',
        agentType: 'CRITIC',
        phase: 'validation',
        level: 'INFO',
        status: 'COMPLETED',
        message: `Critic Agent completed 6-stage validation pipeline across all target patches.`,
        metadata: { total: this.config.fixture.patches.length },
      },
    });

    // 10. SCAN_COMPLETED
    eventsToSchedule.push({
      delaySec: criticDoneTime,
      event: {
        scanId,
        eventType: isRejectedScenario ? 'SCAN_FAILED' : 'SCAN_COMPLETED',
        agentType: 'SYSTEM',
        phase: 'scan',
        level: isRejectedScenario ? 'WARN' : 'INFO',
        status: isRejectedScenario ? 'FAILED' : 'COMPLETED',
        message: isRejectedScenario
          ? 'Scan completed with Critic Rejection on one or more patches'
          : 'Scan completed successfully across all vulnerability pipelines',
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
