/**
 * Critic event collector — bounded in-memory observability sink. Events are
 * structured, ≤300-char details, never raw output. Only the most recent
 * CRITIC_EVENT_MAX_PER_RUN events per run are retained (bounded memory).
 * This phase only collects; a future frontend can stream from it.
 */

import { CRITIC_EVENT_MAX_PER_RUN } from '../../domain/events/critic-events';
import type { CriticEvent, CriticEventSink } from '../../domain/events/critic-events';

export class CriticEventCollector implements CriticEventSink {
  /** runId → recent events, oldest first (bounded per run). */
  private readonly byRun = new Map<string, CriticEvent[]>();

  emit(event: CriticEvent): Promise<void> | void {
    const list = this.byRun.get(event.runId) ?? [];
    list.push(event);
    if (list.length > CRITIC_EVENT_MAX_PER_RUN) {
      list.splice(0, list.length - CRITIC_EVENT_MAX_PER_RUN);
    }
    this.byRun.set(event.runId, list);
  }

  /** All events for one run (bounded), oldest first. */
  forRun(runId: string): readonly CriticEvent[] {
    return this.byRun.get(runId) ?? [];
  }

  recent(limit = 20): readonly CriticEvent[] {
    const all = [...this.byRun.values()].flat();
    return all.slice(-limit);
  }
}