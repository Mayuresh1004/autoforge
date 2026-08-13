/**
 * AMASS Canonical Event Contract (Phase 9 — Observability).
 *
 * Frontend representation mirroring backend domain event model.
 * Monotonic `sequence` is the only ordering key.
 */

export const AMASS_EVENT_TYPES = [
  // workflow
  'SCAN_STARTED',
  'SCAN_COMPLETED',
  'SCAN_FAILED',
  // analyzer (repository analysis)
  'ANALYZER_STARTED',
  'ANALYZER_COMPLETED',
  // static scanner
  'SCANNER_STARTED',
  'SCANNER_FINDING_DISCOVERED',
  'SCANNER_COMPLETED',
  // sandbox lifecycle
  'SANDBOX_PROVISIONING',
  'SANDBOX_READY',
  'SANDBOX_FAILED',
  'SANDBOX_DESTROYING',
  'SANDBOX_DESTROYED',
  // scout (recon)
  'SCOUT_STARTED',
  'SCOUT_TARGET_STARTED',
  'SCOUT_ENDPOINT_DISCOVERED',
  'SCOUT_EVIDENCE_COLLECTED',
  'SCOUT_TARGET_COMPLETED',
  'SCOUT_COMPLETED',
  // planner
  'PLANNER_STARTED',
  'PLANNER_COMPLETED',
  // sniper (verification)
  'SNIPER_STARTED',
  'SNIPER_TARGET_SELECTED',
  'SNIPER_VERIFICATION_STARTED',
  'SNIPER_VERIFICATION_COMPLETED',
  'SNIPER_CONFIRMED',
  'SNIPER_REJECTED',
  // engineer (remediation draft)
  'ENGINEER_STARTED',
  'ENGINEER_SOURCE_READ',
  'ENGINEER_RAG_STARTED',
  'ENGINEER_RAG_COMPLETED',
  'ENGINEER_LLM_STARTED',
  'ENGINEER_LLM_COMPLETED',
  'ENGINEER_PATCH_GENERATED',
  'ENGINEER_REJECTED',
  'ENGINEER_FAILED',
  'ENGINEER_COMPLETED',
  // critic (validation)
  'CRITIC_STARTED',
  'BASELINE_CHECK_STARTED',
  'BASELINE_CHECK_COMPLETED',
  'PATCH_APPLY_STARTED',
  'PATCH_APPLIED',
  'BUILD_STARTED',
  'BUILD_COMPLETED',
  'TESTS_STARTED',
  'TESTS_COMPLETED',
  'EXPLOIT_RETEST_STARTED',
  'EXPLOIT_RETEST_COMPLETED',
  'CRITIC_APPROVED',
  'CRITIC_REJECTED',
  'CRITIC_FAILED',
  'CRITIC_COMPLETED',
  // browser/network observation contract
  'BROWSER_NAVIGATION',
  'BROWSER_PAGE_LOADED',
  'NETWORK_REQUEST',
  'NETWORK_RESPONSE',
] as const;

export type AmassEventType = (typeof AMASS_EVENT_TYPES)[number];

export const AMASS_AGENT_TYPES = [
  'ANALYZER',
  'SCANNER',
  'SANDBOX',
  'SCOUT',
  'PLANNER',
  'SNIPER',
  'ENGINEER',
  'CRITIC',
  'BROWSER',
  'SYSTEM',
] as const;

export type AmassAgentType = (typeof AMASS_AGENT_TYPES)[number];

export const AMASS_PHASES = [
  'scan',
  'analysis',
  'scanning',
  'sandbox',
  'recon',
  'planning',
  'verification',
  'remediation',
  'validation',
  'observation',
] as const;

export type AmassPhase = (typeof AMASS_PHASES)[number];

export const AMASS_EVENT_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
export type AmassEventLevel = (typeof AMASS_EVENT_LEVELS)[number];

export const AMASS_EVENT_STATUSES = [
  'STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'SUCCEEDED',
  'FAILED',
  'READY',
  'CONFIRMED',
  'NOT_CONFIRMED',
  'REJECTED',
  'DESTROYING',
  'DESTROYED',
  'SKIPPED',
] as const;

export type AmassEventStatus = (typeof AMASS_EVENT_STATUSES)[number];

export type AmassMetadataValue = string | number | boolean | null | Record<string, unknown> | Array<unknown>;

export interface AmassEventCounts {
  readonly [key: string]: number;
}

export interface AmassEventMetadata {
  readonly sandboxId?: string;
  readonly targetUrl?: string;
  readonly runtime?: string;
  readonly readiness?: string;
  readonly endpoint?: string;
  readonly method?: string;
  readonly httpStatus?: number;
  readonly source?: string;
  readonly filePath?: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly patchId?: string;
  readonly vulnerabilityId?: string;
  readonly targetId?: string;
  readonly findingId?: string;
  readonly evidence?: string;
  readonly check?: string;
  readonly result?: string;
  readonly error?: string;
  readonly counts?: AmassEventCounts;
  readonly [key: string]: AmassMetadataValue | AmassEventCounts | undefined;
}

export interface AmassEvent {
  readonly eventId: string;
  readonly scanId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly eventType: AmassEventType;
  readonly agentType?: AmassAgentType;
  readonly phase: AmassPhase;
  readonly level: AmassEventLevel;
  readonly status: AmassEventStatus;
  readonly message: string;
  readonly metadata?: AmassEventMetadata;
}

export type SseConnectionStatus = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';
