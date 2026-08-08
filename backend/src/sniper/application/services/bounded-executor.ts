/**
 * Bounded concurrency executor. Never launches unlimited jobs: at most
 * `concurrency` tasks run at once; the rest queue. A worker keeps its task's
 * assigned index so results can be correlated back. Errors are captured per
 * task (a tool failure never crashes the whole run).
 */

export type TaskOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

export class BoundedExecutor {
  constructor(private readonly concurrency: number) {}

  /** Run all tasks with at most `concurrency` in flight. Respects `signal`. */
  async runAll<T>(
    tasks: ReadonlyArray<() => Promise<T>>,
    signal?: AbortSignal
  ): Promise<TaskOutcome<T>[]> {
    const outcomes: TaskOutcome<T>[] = new Array(tasks.length);
    let nextIndex = 0;
    const workers = Math.max(1, Math.min(this.concurrency, tasks.length));

    const work = async (): Promise<void> => {
      while (nextIndex < tasks.length) {
        if (signal?.aborted) return;
        const index = nextIndex;
        nextIndex += 1;
        try {
          outcomes[index] = { ok: true, value: await tasks[index]() };
        } catch (error) {
          outcomes[index] = { ok: false, error };
        }
      }
    };

    const running = new Array<Promise<void>>(workers);
    for (let w = 0; w < workers; w += 1) running[w] = work();
    await Promise.all(running);
    return outcomes;
  }
}