/**
 * AMASS canonical event model (Phase 9 — Observability).
 *
 * ONE typed, bounded event shape for the whole autonomous workflow. Every
 * event carries an identity (`eventId`), the scan it belongs to, a
 * MONOTONIC per-scan `sequence` (never trust timestamps for ordering), a
 * bounded `eventType` union, an optional `agentType`, the pipeline `phase`,
 * a log-style `level`, a lifecycle `status`, a bounded human-readable
 * `message` and bounded structured `metadata`.
 *
 * HARD LIMITS (enforced by the EventBus at publish time):
 *  - eventType is a closed union — arbitrary strings are rejected;
 *  - message is truncated + secret-redacted (reuses the LLM redactor);
 *  - metadata values are redacted/truncated and the whole payload is capped
 *    in bytes; a payload that exceeds the cap is dropped whole, never
 *    partially leaked;
 *  - events NEVER carry API keys, authorization headers, passwords,
 *    cookies, secrets, unrestricted source code/command output or exploit
 *    payloads.
 *
 * Persistence decision (this phase): events are EPHEMERAL — the bus keeps a
 * small bounded ring per scan in memory (never written to Postgres). The
 * durable per-stage record remains the existing `AgentExecution` /
 * `Scan` / `CriticRun` rows. The SSE endpoint therefore serves live events
 * plus a bounded last-window replay (`Last-Event-ID`).
 *
 * BROWSER/NETWORK EVENT CONTRACT: `BROWSER_NAVIGATION`,
 * `BROWSER_PAGE_LOADED`, `NETWORK_REQUEST`, `NETWORK_RESPONSE` are emitted
 * only by a future Playwright/browser observation layer — this phase
 * establishes the typed contract, nothing more.
 */

/** Bounded, closed event-type union. See Phase 9 spec. */
export const AMASS_EVENT_TYPES = [
  // workflow
  'SCAN_STARTED',
  'SCAN_COMPLETED',
  'SCAN_FAILED',
  // analyzer (repository analysis) — Phase 1/2
  'ANALYZER_STARTED',
  'ANALYZER_COMPLETED',
  // static scanner — Phase 2
  'SCANNER_STARTED',
  'SCANNER_COMPLETED',
  // sandbox lifecycle — Phase 6 + runtime sandbox
  'SANDBOX_PROVISIONING',
  'SANDBOX_READY',
  'SANDBOX_FAILED',
  'SANDBOX_DESTROYING',
  'SANDBOX_DESTROYED',
  // scout — Phase 4/5 (recon)
  'SCOUT_STARTED',
  'SCOUT_ENDPOINT_DISCOVERED',
  'SCOUT_COMPLETED',
  // planner — Phase 5
  'PLANNER_STARTED',
  'PLANNER_COMPLETED',
  // sniper — Phase 6 (verification)
  'SNIPER_STARTED',
  'SNIPER_TARGET_SELECTED',
  'SNIPER_VERIFICATION_STARTED',
  'SNIPER_VERIFICATION_COMPLETED',
  'SNIPER_CONFIRMED',
  'SNIPER_NOT_TESTED',
  'SNIPER_REJECTED',
  // engineer — Phase 7 (remediation draft)
  'ENGINEER_STARTED',
  'ENGINEER_SOURCE_RESOLUTION_STARTED',
  'ENGINEER_SOURCE_CANDIDATE',
  'ENGINEER_SOURCE_RESOLVED',
  'ENGINEER_SOURCE_RESOLUTION_FAILED',
  'ENGINEER_SOURCE_READ',
  'ENGINEER_RAG_STARTED',
  'ENGINEER_RAG_COMPLETED',
  'ENGINEER_LLM_STARTED',
  'ENGINEER_LLM_COMPLETED',
  'ENGINEER_PATCH_GENERATED',
  'ENGINEER_REJECTED',
  'ENGINEER_FAILED',
  // critic — Phase 8 (validation)
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
  // remediation delivery
  'REMEDIATION_PR_CREATED',
  'REMEDIATION_DELIVERY_FAILED',
  // browser/network observation (typed contract only — future phase)
  'BROWSER_NAVIGATION',
  'BROWSER_PAGE_LOADED',
  'NETWORK_REQUEST',
  'NETWORK_RESPONSE',
] as const;

export type AmassEventType = (typeof AMASS_EVENT_TYPES)[number];

/** Runtime membership check — guards against arbitrary event-type strings. */
export function isAmassEventType(value: unknown): value is AmassEventType {
  return typeof value === 'string' && (AMASS_EVENT_TYPES as readonly string[]).includes(value);
}

/** Which agent produced the event, when applicable. */
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

/** Pipeline phase of the event. */
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

/** Log-style level. */
export const AMASS_EVENT_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
export type AmassEventLevel = (typeof AMASS_EVENT_LEVELS)[number];

/** Lifecycle status conveyed by the event. */
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

export type AmassMetadataValue = string | number | boolean | null;

export interface AmassEventCounts {
  readonly [key: string]: number;
}

/**
 * Bounded structured metadata. Known keys are declared for the
 * frontend; unknown keys may be written by future observation layers but
 * every value must be a primitive (or a flat counts object) — payloads stay
 * small and serializable. No request/response bodies, ever.
 */
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
  readonly check?: string;
  readonly result?: string;
  readonly error?: string;
  readonly counts?: AmassEventCounts;
  readonly [key: string]: AmassMetadataValue | AmassEventCounts | undefined;
}

/** The canonical event — immutable, fully materialized by the bus. */
export interface AmassEvent {
  readonly eventId: string;
  readonly scanId: string;
  /** Monotonic per-scan sequence — the ONLY ordering key. */
  readonly sequence: number;
  /** ISO-8601 UTC timestamp (informational only). */
  readonly timestamp: string;
  readonly eventType: AmassEventType;
  /** Present when the event belongs to a specific agent. */
  readonly agentType?: AmassAgentType;
  readonly phase: AmassPhase;
  readonly level: AmassEventLevel;
  readonly status: AmassEventStatus;
  /** Bounded, human-readable, sanitized message (≤ messageMaxChars). */
  readonly message: string;
  readonly metadata?: AmassEventMetadata;
}

export const AMASS_EVENT_ID_PREFIX = 'evt';

/** Defaults applied by the bus unless overridden. */
export const DEFAULT_MESSAGE_MAX_CHARS = 300;
export const DEFAULT_METADATA_MAX_BYTES = 2_048;
export const DEFAULT_RING_PER_SCAN = 200;
export const DEFAULT_MAX_SCANS = 100;
export const DEFAULT_HEARTBEAT_MS = 15_000;
export const DEFAULT_SSE_BUFFER_LINES = 200;