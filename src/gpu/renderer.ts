import type { Entity, Graph } from '../compositor/graph.js';
import type { GpuContext } from './device.js';
import type { PresentTarget } from './presentation.js';
import { alignTo, stripPaddedRows } from './readback.js';
import { ResourcePool } from './resources.js';
import { textureForImage } from './upload.js';

const IMAGE_SHADER = `
struct ItemUniforms {
  row0: vec4f,
  row1: vec4f,
  misc: vec4f,
}

@group(0) @binding(0) var<uniform> item: ItemUniforms;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0),
  );
  let uv = corners[index];
  let local = uv * item.misc.xy;
  let world = vec2f(
    item.row0.x * local.x + item.row0.y * local.y + item.row0.z,
    item.row1.x * local.x + item.row1.y * local.y + item.row1.z,
  );
  var output: VertexOutput;
  output.position = vec4f(
    world.x / item.row0.w * 2.0 - 1.0,
    1.0 - world.y / item.row1.w * 2.0,
    0.0,
    1.0,
  );
  output.uv = uv;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(sourceTexture, sourceSampler, input.uv) * item.misc.z;
}
`;

export class ShaderCompilationError extends Error {
  constructor(readonly messages: readonly GPUCompilationMessage[]) {
    super(
      messages
        .map(
          message => `${message.type} at ${message.lineNum}:${message.linePos}: ${message.message}`,
        )
        .join('\n'),
    );
    this.name = 'ShaderCompilationError';
  }
}

interface PipelineRecord {
  bindGroupLayout: GPUBindGroupLayout;
  pipeline: GPURenderPipeline;
}

export interface RendererStats {
  pipelineCount: number;
  sourceTextureBytes: number;
  sourceTextureCount: number;
  uniformBufferCount: number;
}

export function alignedUniformSize(gpu: GpuContext, byteLength: number): number {
  return alignTo(byteLength, Math.max(16, gpu.device.limits.minUniformBufferOffsetAlignment));
}

function placement(entity: Entity): readonly [number, number, number, number, number, number] {
  return entity.matrix ?? [1, 0, 0, 1, entity.x, entity.y];
}

export class GpuImageRenderer {
  private readonly pipelines = new Map<GPUTextureFormat, Promise<PipelineRecord>>();
  private readonly uniforms = new Map<string, GPUBuffer>();
  private readonly retiredTextures: GPUTexture[] = [];
  private readonly sampler: GPUSampler;
  private readonly textures: ResourcePool<GPUTexture>;

  constructor(
    private readonly gpu: GpuContext,
    textureBudgetBytes = 256 * 1024 * 1024,
  ) {
    this.sampler = gpu.device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });
    this.textures = new ResourcePool(textureBudgetBytes, texture => {
      this.retiredTextures.push(texture);
    });
  }

  stats(): RendererStats {
    return {
      pipelineCount: this.pipelines.size,
      sourceTextureBytes: this.textures.bytes,
      sourceTextureCount: this.textures.count,
      uniformBufferCount: this.uniforms.size,
    };
  }

  async present(graph: Graph, target: PresentTarget, width: number, height: number): Promise<void> {
    const view = target.context
      .getCurrentTexture()
      .createView({ format: target.viewFormat, label: 'Pixelf presentation view' });
    await this.renderToView(graph, view, target.viewFormat, width, height);
  }

  async renderToTexture(graph: Graph, width: number, height: number): Promise<GPUTexture> {
    const texture = this.gpu.device.createTexture({
      format: 'rgba8unorm-srgb',
      label: 'Pixelf readback target',
      size: { height, width },
      usage:
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING,
    });
    await this.renderToView(
      graph,
      texture.createView({ format: 'rgba8unorm-srgb' }),
      'rgba8unorm-srgb',
      width,
      height,
    );
    return texture;
  }

  async readback(texture: GPUTexture, width: number, height: number): Promise<Uint8Array> {
    const bytesPerRow = alignTo(width * 4, 256);
    const buffer = this.gpu.device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.gpu.device.createCommandEncoder({ label: 'Pixelf readback encoder' });
    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow, rowsPerImage: height },
      { height, width },
    );
    this.gpu.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange()).slice();
    buffer.unmap();
    buffer.destroy();
    return stripPaddedRows(mapped, width, height, bytesPerRow);
  }

  dispose(): void {
    this.textures.clear();
    for (const buffer of this.uniforms.values()) buffer.destroy();
    this.uniforms.clear();
    for (const texture of this.retiredTextures) texture.destroy();
    this.retiredTextures.length = 0;
    this.pipelines.clear();
  }

  private async renderToView(
    graph: Graph,
    view: GPUTextureView,
    format: GPUTextureFormat,
    width: number,
    height: number,
  ): Promise<void> {
    const record = await this.pipelineFor(format);
    const encoder = this.gpu.device.createCommandEncoder({ label: 'Pixelf image encoder' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: { a: 0, b: 0, g: 0, r: 0 },
          loadOp: 'clear',
          storeOp: 'store',
          view,
        },
      ],
      label: 'Pixelf image pass',
    });
    pass.setPipeline(record.pipeline);
    const activeUniforms = new Set<string>();
    for (const entity of graph.entities) {
      if (entity.source.kind !== 'image') {
        throw new Error(`The first WebGPU path cannot render ${entity.source.kind} sources`);
      }
      if (entity.effects.length > 0 || entity.blend !== 'normal') {
        throw new Error(
          'The first WebGPU path accepts imported images with normal compositing only',
        );
      }
      const uniform = this.uniformFor(entity.id);
      activeUniforms.add(entity.id);
      const [a, b, c, d, e, f] = placement(entity);
      this.gpu.queue.writeBuffer(
        uniform,
        0,
        new Float32Array([a, c, e, width, b, d, f, height, entity.w, entity.h, entity.opacity, 0]),
      );
      const texture = textureForImage(this.gpu, this.textures, entity.source);
      const bindGroup = this.gpu.device.createBindGroup({
        entries: [
          { binding: 0, resource: { buffer: uniform, size: 48 } },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: texture.createView() },
        ],
        layout: record.bindGroupLayout,
      });
      pass.setBindGroup(0, bindGroup);
      pass.draw(6);
    }
    pass.end();
    this.gpu.queue.submit([encoder.finish()]);
    for (const [id, buffer] of this.uniforms) {
      if (activeUniforms.has(id)) continue;
      buffer.destroy();
      this.uniforms.delete(id);
    }
    const retired = this.retiredTextures.splice(0);
    if (retired.length > 0) {
      void this.gpu.queue.onSubmittedWorkDone().then(() => {
        for (const texture of retired) texture.destroy();
      });
    }
  }

  private uniformFor(id: string): GPUBuffer {
    let buffer = this.uniforms.get(id);
    if (buffer !== undefined) return buffer;
    buffer = this.gpu.device.createBuffer({
      label: `Pixelf item ${id}`,
      size: alignedUniformSize(this.gpu, 48),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });
    this.uniforms.set(id, buffer);
    return buffer;
  }

  private pipelineFor(format: GPUTextureFormat): Promise<PipelineRecord> {
    let pending = this.pipelines.get(format);
    if (pending !== undefined) return pending;
    pending = this.createPipeline(format);
    this.pipelines.set(format, pending);
    return pending;
  }

  private async createPipeline(format: GPUTextureFormat): Promise<PipelineRecord> {
    const module = this.gpu.device.createShaderModule({
      code: IMAGE_SHADER,
      label: 'Pixelf image',
    });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error');
    if (errors.length > 0) throw new ShaderCompilationError(errors);
    const bindGroupLayout = this.gpu.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          buffer: { minBindingSize: 48, type: 'uniform' },
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX,
        },
        {
          binding: 1,
          sampler: { type: 'filtering' },
          visibility: GPUShaderStage.FRAGMENT,
        },
        {
          binding: 2,
          texture: { sampleType: 'float', viewDimension: '2d' },
          visibility: GPUShaderStage.FRAGMENT,
        },
      ],
      label: 'Pixelf image bindings',
    });
    const pipelineLayout = this.gpu.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });
    const pipeline = this.gpu.device.createRenderPipeline({
      fragment: {
        entryPoint: 'fragmentMain',
        module,
        targets: [
          {
            blend: {
              alpha: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'one' },
              color: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'one' },
            },
            format,
          },
        ],
      },
      label: `Pixelf image pipeline (${format})`,
      layout: pipelineLayout,
      primitive: { topology: 'triangle-list' },
      vertex: { entryPoint: 'vertexMain', module },
    });
    return { bindGroupLayout, pipeline };
  }
}
