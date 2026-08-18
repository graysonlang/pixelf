export interface GpuResource {
  destroy(): void;
}

interface ResourceEntry<Resource extends GpuResource> {
  bytes: number;
  resource: Resource;
}

export class ResourcePool<Resource extends GpuResource> {
  private readonly entries = new Map<string, ResourceEntry<Resource>>();
  private totalBytes = 0;

  constructor(
    private budgetBytes: number,
    private readonly retire?: (resource: Resource) => void,
  ) {}

  get bytes(): number {
    return this.totalBytes;
  }

  get budget(): number {
    return this.budgetBytes;
  }

  get count(): number {
    return this.entries.size;
  }

  get(key: string): Resource | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.resource;
  }

  set(key: string, resource: Resource, bytes: number): void {
    if (!Number.isFinite(bytes) || bytes < 0)
      throw new Error('Resource bytes must be non-negative');
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.entries.delete(key);
      this.totalBytes -= previous.bytes;
      if (previous.resource !== resource) this.disposeResource(previous.resource);
    }
    this.entries.set(key, { bytes, resource });
    this.totalBytes += bytes;
    this.evictToBudget(key);
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    this.entries.delete(key);
    this.totalBytes -= entry.bytes;
    this.disposeResource(entry.resource);
  }

  setBudget(bytes: number): void {
    if (!Number.isFinite(bytes) || bytes < 0)
      throw new Error('Resource budget must be non-negative');
    this.budgetBytes = bytes;
    this.evictToBudget();
  }

  clear(): void {
    for (const entry of this.entries.values()) this.disposeResource(entry.resource);
    this.entries.clear();
    this.totalBytes = 0;
  }

  private disposeResource(resource: Resource): void {
    if (this.retire !== undefined) this.retire(resource);
    else resource.destroy();
  }

  private evictToBudget(keep?: string): void {
    for (const [key, entry] of this.entries) {
      if (this.totalBytes <= this.budgetBytes) return;
      if (key === keep) continue;
      this.entries.delete(key);
      this.totalBytes -= entry.bytes;
      this.disposeResource(entry.resource);
    }
  }
}
