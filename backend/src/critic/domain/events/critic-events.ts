/**
 * Critic observability events — structured, bounded signals for the future
 * live-sandbox UI. This phase only EMITS backend events (no frontend).
 * Events never carry secrets or unrestricted command output.
 */

export type CriticEventName =
  | 'SANDBOX_PROVISIONING'
  | 'SANDBOX_READY'
  | 'BASELINE_CHECK_STARTED'
  | 'BASELINE_CHECK_COMPLETED'
  | 'PATCH_APPLY_STARTED'
  | 'PATCH_APPLIED'
  | 'BUILD_STARTED'
  | 'BUILD_COMPLETED'
  | 'TESTS_STARTED'
  | 'TESTS_COMPLETED'
  | 'EXPLOIT_RETEST_STARTED'
  | 'EXPLOIT_RETEST_COMPLETED'
  | 'CRITIC_APPROVED'
  | 'CRITIC_REJECTED'
  | 'SANDBOX_DESTROYING'
  | 'SANDBOX_DESTROYED';

export const CRITIC_EVENT_NAMES: readonly CriticEventName[] = [
  'SANDBOX_PROVISIONING',
  'SANDBOX_READY',
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
  'SANDBOX_DESTROYING',
  'SANDBOX_DESTROYED',
];

export interface CriticEvent {
  readonly name: CriticEventName;
  readonly runId: string;
  readonly recordedAt: string;
  /** Bounded context (≤ 300 chars), sanitized. */
  readonly detail?: string | null;
}

/** Cap on retained events per run (bounded memory, bounded payloads). */
export const CRITIC_EVENT_MAX_PER_RUN = 48;

export interface CriticEventSink {
  emit(event: CriticEvent): Promise<void> | void;
}