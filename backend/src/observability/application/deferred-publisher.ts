/**
 * DeferredEventPublisher — used by the scan pipelines whose scan row (and
 * therefore its canonical scanId) is created only AFTER the first stages
 * (repository clone/analysis, analysis sandbox). Events emitted before the
 * scanId exists are buffered and flushed IN ORDER right behind
 * `SCAN_STARTED`, so the stream is coherent, deterministic and never emits
 * an event for an unknown scanId.
 */

import type { AmassEventInput, AmassEventPublisher } from '../domain/ports/event-bus';
import type { AmassEventType, AmassAgentType, AmassPhase, AmassEventLevel, AmassEventStatus, AmassEventMetadata } from '../domain/events/amass-event';

export class DeferredEventPublisher {
  private readonly pending: AmassEventInput[] = [];

  constructor(private readonly publisher: AmassEventPublisher | undefined) {}

  /** Publish now when the scanId exists, else buffer in order. */
  emit(
    input: Omit<AmassEventInput, 'scanId'> & { readonly scanId?: string | null },
  ): void {
    if (!this.publisher) return;
    if (input.scanId) {
      this.publisher.publish({ ...input, scanId: input.scanId });
      return;
    }
    const { scanId: _ignored, ...rest } = input;
    this.pending.push(rest as AmassEventInput);
  }

  /** Flush buffered events (oldest first) — call right after SCAN_STARTED. */
  flush(scanId: string): void {
    if (!this.publisher) {
      this.pending.length = 0;
      return;
    }
    for (const pending of this.pending.splice(0)) {
      this.publisher.publish({ ...pending, scanId });
    }
  }

  /** Drop buffered events (failure before a scanId existed). */
  discard(): void {
    this.pending.length = 0;
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}

// Re-export types so import sites stay single-line.
export type { AmassEventType, AmassAgentType, AmassPhase, AmassEventLevel, AmassEventStatus, AmassEventMetadata };