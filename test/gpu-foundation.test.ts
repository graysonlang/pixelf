import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { srgbChannelToLinear } from '../src/browser/decode-image.js';
import { image, makeSurface } from '../src/compositor/index.js';
import {
  alignedUniformSize,
  alignTo,
  compareGpuBytesToReference,
  GpuDeviceManager,
  GpuImageRenderer,
  hybridNearestBlend,
  premultipliedSrgbMipLevels,
  previewDeviceProjection,
  projectImagePlacement,
  ResourcePool,
  srgbViewFormat,
  stripPaddedRows,
  type GpuContext,
  type GpuDeviceState,
} from '../src/gpu/index.js';

class TestResource {
  destroyed = false;

  destroy(): void {
    this.destroyed = true;
  }
}

interface FakeDevice {
  device: GPUDevice;
  lose(info: GPUDeviceLostInfo): void;
  wasDestroyed(): boolean;
}

function fakeDevice(): FakeDevice {
  let resolveLoss: (info: GPUDeviceLostInfo) => void = () => {};
  let destroyed = false;
  const lost = new Promise<GPUDeviceLostInfo>(resolve => {
    resolveLoss = resolve;
  });
  const device = {
    destroy: () => {
      destroyed = true;
    },
    lost,
    queue: {},
  } as unknown as GPUDevice;
  return { device, lose: resolveLoss, wasDestroyed: () => destroyed };
}

describe('WebGPU foundation', () => {
  it('bounds reusable resources with LRU eviction and oversized admission', () => {
    const pool = new ResourcePool<TestResource>(10);
    const first = new TestResource();
    const second = new TestResource();
    const oversized = new TestResource();
    pool.set('first', first, 6);
    pool.set('second', second, 6);
    assert.equal(first.destroyed, true);
    assert.equal(pool.get('second'), second);
    pool.set('large', oversized, 20);
    assert.equal(second.destroyed, true);
    assert.deepEqual({ bytes: pool.bytes, count: pool.count }, { bytes: 20, count: 1 });
    pool.clear();
    assert.equal(oversized.destroyed, true);
  });

  it('encodes alpha-safe premultiplied mips without transparent blue bleed', () => {
    const source = image(2, 1, new Float32Array([1, 0, 0, 1, 0, 0, 1, 0]), 'mip-test');
    const levels = premultipliedSrgbMipLevels(source);
    assert.equal(levels.length, 2);
    assert.deepEqual([...(levels[1]?.data ?? [])], [188, 0, 0, 128]);
  });

  it('aligns and strips WebGPU readback rows deterministically', () => {
    assert.equal(alignTo(12, 256), 256);
    const padded = new Uint8Array(512);
    padded.set([1, 2, 3, 4, 5, 6, 7, 8], 0);
    padded.set([9, 10, 11, 12, 13, 14, 15, 16], 256);
    assert.deepEqual(
      [...stripPaddedRows(padded, 2, 2, 256)],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    );
  });

  it('compares encoded GPU bytes to the linear CPU oracle with explicit tolerance', () => {
    const reference = makeSurface({ h: 1, w: 1, x: 0, y: 0 });
    reference.data.set([0.5, 0.25, 0, 0.5]);
    const comparison = compareGpuBytesToReference(new Uint8Array([189, 138, 1, 128]), reference, 2);
    assert.deepEqual(comparison, { comparedPixels: 1, maximumColorDifference: 1 });
    assert.throws(
      () => compareGpuBytesToReference(new Uint8Array([200, 137, 0, 128]), reference, 2),
      /GPU color differs/,
    );
    assert.throws(
      () => compareGpuBytesToReference(new Uint8Array([188, 137, 0, 127]), reference, 2),
      /GPU alpha differs/,
    );
  });

  it('uses explicit sRGB views, aligned uniforms, and standard source decoding', () => {
    assert.equal(srgbViewFormat('bgra8unorm'), 'bgra8unorm-srgb');
    assert.equal(srgbViewFormat('rgba16float'), 'rgba16float');
    const gpu = {
      device: { limits: { minUniformBufferOffsetAlignment: 256 } },
    } as unknown as GpuContext;
    assert.equal(alignedUniformSize(gpu, 48), 256);
    assert.equal(srgbChannelToLinear(0), 0);
    assert.ok(Math.abs(srgbChannelToLinear(0.04045) - 0.0031308) < 1e-7);
    assert.equal(srgbChannelToLinear(1), 1);
  });

  it('projects the document through the physical viewport and snaps exact texel scales', () => {
    const projection = previewDeviceProjection(
      { cssHeight: 400, cssWidth: 600, panX: 0, panY: 0, zoom: 1 },
      1200,
      800,
      101,
      51,
    );
    assert.deepEqual(projection, {
      offsetX: 499,
      offsetY: 349,
      scaleX: 2,
      scaleY: 2,
      scissor: { height: 102, width: 202, x: 499, y: 349 },
    });
    assert.deepEqual(
      projectImagePlacement([1, 0, 0, 1, 0.24, 0.24], projection, 101, 51, 101, 51),
      [2, 0, 0, 2, 499, 349],
    );
    assert.equal(
      previewDeviceProjection(
        { cssHeight: 400, cssWidth: 600, panX: 1000, panY: 1000, zoom: 1 },
        1200,
        800,
        101,
        51,
      ).scissor,
      null,
    );
  });

  it('uses mipped linear sampling below the adaptive band and nearest at exact scales', () => {
    assert.equal(hybridNearestBlend(0.25), 0);
    assert.equal(hybridNearestBlend(1), 1);
    assert.equal(hybridNearestBlend(2.5) > 0, true);
    assert.equal(hybridNearestBlend(2.5) < 1, true);
    assert.equal(hybridNearestBlend(3), 1);
    assert.equal(hybridNearestBlend(6), 1);
  });

  it('waits for the pipeline before acquiring a presentation texture', async () => {
    const shaderStageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'GPUShaderStage');
    const textureUsageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'GPUTextureUsage');
    const bufferUsageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'GPUBufferUsage');
    Object.defineProperty(globalThis, 'GPUShaderStage', {
      configurable: true,
      value: { FRAGMENT: 2, VERTEX: 1 },
    });
    Object.defineProperty(globalThis, 'GPUTextureUsage', {
      configurable: true,
      value: { COPY_SRC: 1, RENDER_ATTACHMENT: 2, TEXTURE_BINDING: 4 },
    });
    Object.defineProperty(globalThis, 'GPUBufferUsage', {
      configurable: true,
      value: { COPY_DST: 1, UNIFORM: 2 },
    });
    const events: string[] = [];
    const pass = {
      draw: () => {},
      end: () => {},
      setBindGroup: () => {},
      setPipeline: () => {},
    };
    const device = {
      createBindGroup: () => ({}),
      createBindGroupLayout: () => ({}),
      createBuffer: () => ({ destroy: () => {} }),
      createCommandEncoder: () => ({
        beginRenderPass: () => pass,
        finish: () => ({}),
      }),
      createPipelineLayout: () => ({}),
      createRenderPipeline: () => ({}),
      createSampler: () => ({}),
      createShaderModule: () => ({
        getCompilationInfo: async () => {
          events.push('pipeline-ready');
          return { messages: [] };
        },
      }),
      createTexture: () => ({ createView: () => ({}), destroy: () => {} }),
      limits: { minUniformBufferOffsetAlignment: 256 },
    } as unknown as GPUDevice;
    const renderer = new GpuImageRenderer({
      adapter: {} as GPUAdapter,
      device,
      preferredCanvasFormat: 'bgra8unorm',
      queue: {
        onSubmittedWorkDone: async () => {},
        submit: () => events.push('submitted'),
        writeBuffer: () => {},
      } as unknown as GPUQueue,
    });
    const target = {
      canvas: {} as HTMLCanvasElement,
      colorSpace: 'srgb' as const,
      context: {
        getCurrentTexture: () => {
          events.push('texture-acquired');
          return { createView: () => ({}) };
        },
      } as unknown as GPUCanvasContext,
      format: 'bgra8unorm' as GPUTextureFormat,
      viewFormat: 'bgra8unorm-srgb' as GPUTextureFormat,
    };
    try {
      await renderer.present({ entities: [] }, target, 1, 1);
      assert.deepEqual(events, [
        'pipeline-ready',
        'pipeline-ready',
        'pipeline-ready',
        'submitted',
        'texture-acquired',
        'submitted',
      ]);
    } finally {
      renderer.dispose();
      for (const [name, descriptor] of [
        ['GPUShaderStage', shaderStageDescriptor],
        ['GPUTextureUsage', textureUsageDescriptor],
        ['GPUBufferUsage', bufferUsageDescriptor],
      ] as const) {
        if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
        else Object.defineProperty(globalThis, name, descriptor);
      }
    }
  });

  it('reacquires a device after loss and advances the projection generation', async () => {
    const first = fakeDevice();
    const second = fakeDevice();
    const devices = [first.device, second.device];
    let requestIndex = 0;
    const adapter = {
      requestDevice: async () => {
        const device = devices[requestIndex];
        requestIndex += 1;
        if (device === undefined) throw new Error('Unexpected device request');
        return device;
      },
    } as unknown as GPUAdapter;
    const provider = {
      getPreferredCanvasFormat: () => 'bgra8unorm',
      requestAdapter: async () => adapter,
    } as unknown as GPU;
    const states: GpuDeviceState[] = [];
    let resolveRecovered: (generation: number) => void = () => {};
    const recovered = new Promise<number>(resolve => {
      resolveRecovered = resolve;
    });
    const manager = new GpuDeviceManager({
      onContext: (_context, generation) => {
        if (generation === 2) resolveRecovered(generation);
      },
      onState: state => states.push(state),
      provider,
    });
    const initial = await manager.initialize();
    assert.equal(initial?.device, first.device);
    first.lose({ message: 'test reset', reason: 'unknown' } as unknown as GPUDeviceLostInfo);
    assert.equal(await recovered, 2);
    assert.equal(manager.current?.device, second.device);
    assert.ok(states.some(state => state.kind === 'lost'));
    manager.dispose();
    assert.equal(second.wasDestroyed(), true);
  });
});
