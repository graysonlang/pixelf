export type RenderStage =
  | 'cacheLookup'
  | 'commandEncoding'
  | 'decode'
  | 'evaluate'
  | 'gpuExecution'
  | 'readback'
  | 'upload';

export interface MetricSnapshot {
  cacheEvictions: number;
  cacheHits: number;
  cacheMisses: number;
  stages: Record<RenderStage, { calls: number; milliseconds: number }>;
}

const stages: readonly RenderStage[] = [
  'cacheLookup',
  'commandEncoding',
  'decode',
  'evaluate',
  'gpuExecution',
  'readback',
  'upload',
];

export class RenderMetrics {
  private cacheEvictions = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private readonly timings = new Map<RenderStage, { calls: number; milliseconds: number }>();

  constructor(private readonly now: () => number = () => performance.now()) {
    for (const stage of stages) this.timings.set(stage, { calls: 0, milliseconds: 0 });
  }

  measure<Value>(stage: RenderStage, operation: () => Value): Value {
    const start = this.now();
    try {
      return operation();
    } finally {
      this.record(stage, this.now() - start);
    }
  }

  async measureAsync<Value>(stage: RenderStage, operation: () => Promise<Value>): Promise<Value> {
    const start = this.now();
    try {
      return await operation();
    } finally {
      this.record(stage, this.now() - start);
    }
  }

  recordCache(hit: boolean, evictions = 0): void {
    if (hit) this.cacheHits += 1;
    else this.cacheMisses += 1;
    this.cacheEvictions += evictions;
  }

  snapshot(): MetricSnapshot {
    return {
      cacheEvictions: this.cacheEvictions,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      stages: Object.fromEntries(
        stages.map(stage => [
          stage,
          { ...(this.timings.get(stage) ?? { calls: 0, milliseconds: 0 }) },
        ]),
      ) as MetricSnapshot['stages'],
    };
  }

  private record(stage: RenderStage, milliseconds: number): void {
    const timing = this.timings.get(stage);
    if (timing === undefined) return;
    timing.calls += 1;
    timing.milliseconds += milliseconds;
  }
}
