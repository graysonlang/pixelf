export interface GpuContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  preferredCanvasFormat: GPUTextureFormat;
  queue: GPUQueue;
}

export type GpuDeviceState =
  | { kind: 'idle' }
  | { kind: 'acquiring' }
  | { context: GpuContext; generation: number; kind: 'ready' }
  | { kind: 'unsupported'; message: string }
  | { generation: number; kind: 'lost'; message: string };

export interface AcquireGpuOptions {
  onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  provider?: GPU;
}

function defaultProvider(): GPU | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.gpu;
}

export function gpuSupported(provider = defaultProvider()): boolean {
  return provider !== undefined;
}

export async function acquireGpu(options: AcquireGpuOptions = {}): Promise<GpuContext | null> {
  const provider = options.provider ?? defaultProvider();
  if (provider === undefined) return null;
  const adapter = await provider.requestAdapter({ powerPreference: 'high-performance' });
  if (adapter === null) return null;
  const device = await adapter.requestDevice();
  if (options.onDeviceLost !== undefined) void device.lost.then(options.onDeviceLost);
  return {
    adapter,
    device,
    preferredCanvasFormat: provider.getPreferredCanvasFormat(),
    queue: device.queue,
  };
}

export interface DeviceManagerOptions {
  onContext?: (context: GpuContext, generation: number) => void;
  onState?: (state: GpuDeviceState) => void;
  provider?: GPU;
}

export class GpuDeviceManager {
  private context: GpuContext | null = null;
  private disposed = false;
  private generation = 0;
  private acquiring: Promise<GpuContext | null> | null = null;

  constructor(private readonly options: DeviceManagerOptions = {}) {}

  get current(): GpuContext | null {
    return this.context;
  }

  async initialize(): Promise<GpuContext | null> {
    if (this.disposed) return null;
    if (this.acquiring !== null) return this.acquiring;
    this.options.onState?.({ kind: 'acquiring' });
    const pending = acquireGpu({
      onDeviceLost: info => this.handleLoss(info),
      provider: this.options.provider,
    });
    this.acquiring = pending;
    try {
      const context = await pending;
      if (this.disposed) {
        context?.device.destroy();
        return null;
      }
      if (context === null) {
        this.options.onState?.({
          kind: 'unsupported',
          message: 'WebGPU is unavailable. Pixelf can still open the source image.',
        });
        return null;
      }
      this.context = context;
      this.generation += 1;
      this.options.onState?.({ context, generation: this.generation, kind: 'ready' });
      this.options.onContext?.(context, this.generation);
      return context;
    } finally {
      if (this.acquiring === pending) this.acquiring = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.context?.device.destroy();
    this.context = null;
  }

  private handleLoss(info: GPUDeviceLostInfo): void {
    if (this.disposed) return;
    this.context = null;
    this.options.onState?.({
      generation: this.generation,
      kind: 'lost',
      message: info.message || `WebGPU device was lost: ${info.reason}`,
    });
    void this.initialize();
  }
}
