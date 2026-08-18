export type MemoryClass = 'cpuWorking' | 'decodedSources' | 'derivedTiles' | 'gpuTextures';

export interface BudgetUsage {
  budgetBytes: number;
  bytes: number;
  entries: number;
  evictions: number;
}

export class MemoryBudget {
  private readonly entries = new Map<string, number>();
  private byteCount = 0;
  private evictionCount = 0;

  constructor(readonly budgetBytes: number) {
    if (!Number.isFinite(budgetBytes) || budgetBytes < 0) {
      throw new Error('Memory budget must be a non-negative number');
    }
  }

  reserve(key: string, bytes: number): readonly string[] {
    if (!Number.isFinite(bytes) || bytes < 0)
      throw new Error('Reserved bytes must be non-negative');
    this.release(key);
    this.entries.set(key, bytes);
    this.byteCount += bytes;
    const evicted: string[] = [];
    while (this.byteCount > this.budgetBytes && this.entries.size > 1) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.release(oldest);
      evicted.push(oldest);
      this.evictionCount += 1;
    }
    return evicted;
  }

  touch(key: string): boolean {
    const bytes = this.entries.get(key);
    if (bytes === undefined) return false;
    this.entries.delete(key);
    this.entries.set(key, bytes);
    return true;
  }

  release(key: string): boolean {
    const bytes = this.entries.get(key);
    if (bytes === undefined) return false;
    this.entries.delete(key);
    this.byteCount -= bytes;
    return true;
  }

  usage(): BudgetUsage {
    return {
      budgetBytes: this.budgetBytes,
      bytes: this.byteCount,
      entries: this.entries.size,
      evictions: this.evictionCount,
    };
  }
}

export class RuntimeBudgets {
  readonly cpuWorking: MemoryBudget;
  readonly decodedSources: MemoryBudget;
  readonly derivedTiles: MemoryBudget;
  readonly gpuTextures: MemoryBudget;

  constructor(limits: Record<MemoryClass, number>) {
    this.cpuWorking = new MemoryBudget(limits.cpuWorking);
    this.decodedSources = new MemoryBudget(limits.decodedSources);
    this.derivedTiles = new MemoryBudget(limits.derivedTiles);
    this.gpuTextures = new MemoryBudget(limits.gpuTextures);
  }

  snapshot(): Record<MemoryClass, BudgetUsage> {
    return {
      cpuWorking: this.cpuWorking.usage(),
      decodedSources: this.decodedSources.usage(),
      derivedTiles: this.derivedTiles.usage(),
      gpuTextures: this.gpuTextures.usage(),
    };
  }
}
