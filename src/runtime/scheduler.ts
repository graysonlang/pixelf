export type WorkClass = 'export' | 'foreground' | 'refinement' | 'thumbnail';
export type ScheduledResult<Value> =
  | { status: 'canceled' | 'stale' }
  | { error: unknown; status: 'failed' }
  | { status: 'completed'; value: Value };

interface PendingTask<Value> {
  generation: number;
  kind: WorkClass;
  resolve(result: ScheduledResult<Value>): void;
  run(signal: AbortSignal): Promise<Value>;
}

const priorities: Record<WorkClass, number> = {
  foreground: 0,
  refinement: 1,
  thumbnail: 2,
  export: 3,
};

export class WorkScheduler {
  private readonly controllerByGeneration = new Map<number, AbortController>();
  private currentGeneration = 0;
  private running = 0;
  private readonly queue: PendingTask<unknown>[] = [];

  constructor(readonly concurrency = 2) {
    if (!Number.isInteger(concurrency) || concurrency <= 0) {
      throw new Error('Scheduler concurrency must be a positive integer');
    }
  }

  beginGeneration(): number {
    this.currentGeneration += 1;
    for (const [generation, controller] of this.controllerByGeneration) {
      if (generation < this.currentGeneration) {
        controller.abort();
        this.controllerByGeneration.delete(generation);
      }
    }
    this.pump();
    return this.currentGeneration;
  }

  schedule<Value>(
    kind: WorkClass,
    generation: number,
    run: (signal: AbortSignal) => Promise<Value> | Value,
  ): Promise<ScheduledResult<Value>> {
    return new Promise(resolve => {
      this.queue.push({
        generation,
        kind,
        resolve: resolve as (result: ScheduledResult<unknown>) => void,
        run: async signal => run(signal),
      });
      this.queue.sort((left, right) => priorities[left.kind] - priorities[right.kind]);
      this.pump();
    });
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (task === undefined) return;
      if (task.generation !== this.currentGeneration) {
        task.resolve({ status: 'stale' });
        continue;
      }
      const controller = this.controllerByGeneration.get(task.generation) ?? new AbortController();
      this.controllerByGeneration.set(task.generation, controller);
      this.running += 1;
      void task
        .run(controller.signal)
        .then(value => {
          if (controller.signal.aborted) task.resolve({ status: 'canceled' });
          else if (task.generation !== this.currentGeneration) task.resolve({ status: 'stale' });
          else task.resolve({ status: 'completed', value });
        })
        .catch(error => {
          if (controller.signal.aborted) task.resolve({ status: 'canceled' });
          else task.resolve({ error, status: 'failed' });
        })
        .finally(() => {
          this.running -= 1;
          this.pump();
        });
    }
  }
}
