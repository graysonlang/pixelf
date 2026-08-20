import { graphHash, image, type Entity, type Graph } from '../compositor/graph.js';
import { renderRegion } from '../compositor/render.js';
import type { GpuContext } from './device.js';
import type { PresentTarget } from './presentation.js';
import { alignTo, stripPaddedRows } from './readback.js';
import { ResourcePool } from './resources.js';
import { textureForImage } from './upload.js';
import {
  HYBRID_NEAREST_END,
  HYBRID_NEAREST_START,
  previewDeviceProjection,
  projectImagePlacement,
  type DeviceProjection,
  type ViewportPresentation,
} from './viewport.js';

const IMAGE_SHADER = `
struct ItemUniforms {
  row0: vec4f,
  row1: vec4f,
  misc: vec4f,
}

@group(0) @binding(0) var<uniform> item: ItemUniforms;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var nearestSampler: sampler;

const ADAPT_START: f32 = ${HYBRID_NEAREST_START}.0;
const ADAPT_END: f32 = ${HYBRID_NEAREST_END}.0;

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
  // The uploaded chain is box-filtered in premultiplied linear light. The linear
  // sampler therefore supplies alpha-safe bilinear/trilinear reduction directly.
  var sampled = textureSample(sourceTexture, sourceSampler, input.uv);
  let dimensions = vec2f(textureDimensions(sourceTexture, 0));
  let texelsPerPixel = max(
    max(fwidth(input.uv.x) * dimensions.x, fwidth(input.uv.y) * dimensions.y),
    1e-6,
  );
  let magnification = 1.0 / texelsPerPixel;
  let integerMagnification = round(magnification);
  let integerSnap = select(
    0.0,
    1.0,
    integerMagnification >= 1.0 &&
      abs(magnification - integerMagnification) < 0.002 * integerMagnification,
  );
  let nearestBlend = max(
    smoothstep(ADAPT_START, ADAPT_END, magnification),
    integerSnap,
  );
  nearestBlend = max(nearestBlend, item.misc.w);
  sampled = mix(
    sampled,
    textureSample(sourceTexture, nearestSampler, input.uv),
    nearestBlend,
  );
  return sampled * item.misc.z;
}
`;

const MIP_SHADER = `
struct MipUniforms {
  destinationWidth: u32,
  destinationHeight: u32,
  padding0: u32,
  padding1: u32,
}

@group(0) @binding(0) var<uniform> mip: MipUniforms;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;

struct MipVertexOutput {
  @builtin(position) position: vec4f,
}

@vertex
fn mipVertex(@builtin(vertex_index) index: u32) -> MipVertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
  );
  var output: MipVertexOutput;
  output.position = vec4f(corners[index], 0.0, 1.0);
  return output;
}

@fragment
fn mipFragment(input: MipVertexOutput) -> @location(0) vec4f {
  let destinationX = u32(input.position.x);
  let destinationY = u32(input.position.y);
  let sourceSize = textureDimensions(sourceTexture, 0);
  let sourceX0 = (destinationX * sourceSize.x) / mip.destinationWidth;
  let sourceY0 = (destinationY * sourceSize.y) / mip.destinationHeight;
  let sourceX1 = max(
    sourceX0 + 1u,
    ((destinationX + 1u) * sourceSize.x) / mip.destinationWidth,
  );
  let sourceY1 = max(
    sourceY0 + 1u,
    ((destinationY + 1u) * sourceSize.y) / mip.destinationHeight,
  );
  var sum = vec4f(0.0);
  for (var sourceY = sourceY0; sourceY < sourceY1; sourceY += 1u) {
    for (var sourceX = sourceX0; sourceX < sourceX1; sourceX += 1u) {
      sum += textureLoad(sourceTexture, vec2i(i32(sourceX), i32(sourceY)), 0);
    }
  }
  let count = f32((sourceX1 - sourceX0) * (sourceY1 - sourceY0));
  return sum / count;
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

interface PresentationComposite {
  key: string;
  texture: GPUTexture;
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

export function gpuDirectRenderable(graph: Graph): boolean {
  return graph.entities.every(
    entity =>
      entity.source.kind === 'image' &&
      entity.effects.length === 0 &&
      entity.mask === undefined &&
      entity.blend === 'normal',
  );
}

export function flattenGraphForGpu(graph: Graph, width: number, height: number): Graph {
  if (gpuDirectRenderable(graph)) return graph;
  const surface = renderRegion(graph, { h: height, w: width, x: 0, y: 0 }, 1);
  const straight = new Float32Array(surface.data.length);
  for (let offset = 0; offset < straight.length; offset += 4) {
    const alpha = surface.data[offset + 3] ?? 0;
    straight[offset] = alpha > 0 ? (surface.data[offset] ?? 0) / alpha : 0;
    straight[offset + 1] = alpha > 0 ? (surface.data[offset + 1] ?? 0) / alpha : 0;
    straight[offset + 2] = alpha > 0 ? (surface.data[offset + 2] ?? 0) / alpha : 0;
    straight[offset + 3] = alpha;
  }
  const revision = graphHash(graph);
  return {
    entities: [
      {
        blend: 'normal',
        effects: [],
        h: height,
        id: `flattened:${revision}`,
        opacity: 1,
        source: image(width, height, straight, revision),
        w: width,
        x: 0,
        y: 0,
      },
    ],
  };
}

export class GpuImageRenderer {
  private readonly pipelines = new Map<GPUTextureFormat, Promise<PipelineRecord>>();
  private readonly mipPipelines = new Map<GPUTextureFormat, Promise<PipelineRecord>>();
  private readonly uniforms = new Map<string, GPUBuffer>();
  private readonly retiredTextures: GPUTexture[] = [];
  private readonly linearSampler: GPUSampler;
  private readonly nearestSampler: GPUSampler;
  private readonly textures: ResourcePool<GPUTexture>;
  private presentationComposite: PresentationComposite | null = null;

  constructor(
    private readonly gpu: GpuContext,
    textureBudgetBytes = 256 * 1024 * 1024,
  ) {
    this.linearSampler = gpu.device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });
    this.nearestSampler = gpu.device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter: 'nearest',
      minFilter: 'nearest',
      mipmapFilter: 'nearest',
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

  async present(
    graph: Graph,
    target: PresentTarget,
    width: number,
    height: number,
    viewport?: ViewportPresentation,
  ): Promise<void> {
    const [compositePipeline, presentationPipeline, mipPipeline] = await Promise.all([
      this.pipelineFor('rgba8unorm-srgb'),
      this.pipelineFor(target.viewFormat),
      this.mipPipelineFor('rgba8unorm-srgb'),
    ]);
    const composite = this.compositeForPresentation(
      graph,
      width,
      height,
      compositePipeline,
      mipPipeline,
    );
    const view = target.context
      .getCurrentTexture()
      .createView({ format: target.viewFormat, label: 'Pixelf presentation view' });
    const outputWidth = viewport === undefined ? width : target.canvas.width;
    const outputHeight = viewport === undefined ? height : target.canvas.height;
    const projection =
      viewport === undefined
        ? undefined
        : previewDeviceProjection(viewport, outputWidth, outputHeight, width, height);
    this.renderTextureToView(
      composite,
      view,
      presentationPipeline,
      width,
      height,
      outputWidth,
      outputHeight,
      projection,
      viewport === undefined || Math.abs(viewport.zoom - 1) < 1e-6,
    );
  }

  async renderToTexture(graph: Graph, width: number, height: number): Promise<GPUTexture> {
    const flattened = flattenGraphForGpu(graph, width, height);
    const pipeline = await this.pipelineFor('rgba8unorm-srgb');
    const texture = this.gpu.device.createTexture({
      format: 'rgba8unorm-srgb',
      label: 'Pixelf readback target',
      size: { height, width },
      usage:
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING,
    });
    this.renderToView(
      flattened,
      texture.createView({ format: 'rgba8unorm-srgb' }),
      pipeline,
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
    this.presentationComposite?.texture.destroy();
    this.presentationComposite = null;
    for (const buffer of this.uniforms.values()) buffer.destroy();
    this.uniforms.clear();
    for (const texture of this.retiredTextures) texture.destroy();
    this.retiredTextures.length = 0;
    this.pipelines.clear();
    this.mipPipelines.clear();
  }

  private compositeForPresentation(
    graph: Graph,
    width: number,
    height: number,
    pipeline: PipelineRecord,
    mipPipeline: PipelineRecord,
  ): GPUTexture {
    const key = `${width}x${height}:${graphHash(graph)}`;
    if (this.presentationComposite?.key === key) return this.presentationComposite.texture;
    if (this.presentationComposite !== null) {
      this.retiredTextures.push(this.presentationComposite.texture);
    }
    const mipLevelCount = Math.floor(Math.log2(Math.max(width, height))) + 1;
    const texture = this.gpu.device.createTexture({
      format: 'rgba8unorm-srgb',
      label: 'Pixelf target preview',
      mipLevelCount,
      size: { height, width },
      usage:
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING,
    });
    this.presentationComposite = { key, texture };
    const flattened = flattenGraphForGpu(graph, width, height);
    this.renderToView(
      flattened,
      texture.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
      pipeline,
      width,
      height,
    );
    this.generateMips(texture, width, height, mipLevelCount, mipPipeline);
    return texture;
  }

  private generateMips(
    texture: GPUTexture,
    width: number,
    height: number,
    mipLevelCount: number,
    record: PipelineRecord,
  ): void {
    if (mipLevelCount <= 1) return;
    const encoder = this.gpu.device.createCommandEncoder({ label: 'Pixelf mip encoder' });
    const buffers: GPUBuffer[] = [];
    let destinationWidth = width;
    let destinationHeight = height;
    for (let level = 1; level < mipLevelCount; level += 1) {
      destinationWidth = Math.max(1, Math.floor(destinationWidth / 2));
      destinationHeight = Math.max(1, Math.floor(destinationHeight / 2));
      const uniform = this.gpu.device.createBuffer({
        label: `Pixelf mip ${level}`,
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
      });
      this.gpu.queue.writeBuffer(
        uniform,
        0,
        new Uint32Array([destinationWidth, destinationHeight, 0, 0]),
      );
      buffers.push(uniform);
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            loadOp: 'clear',
            storeOp: 'store',
            view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
          },
        ],
        label: `Pixelf mip pass ${level}`,
      });
      pass.setPipeline(record.pipeline);
      pass.setBindGroup(
        0,
        this.gpu.device.createBindGroup({
          entries: [
            { binding: 0, resource: { buffer: uniform, size: 16 } },
            {
              binding: 1,
              resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }),
            },
          ],
          layout: record.bindGroupLayout,
        }),
      );
      pass.draw(6);
      pass.end();
    }
    this.gpu.queue.submit([encoder.finish()]);
    void this.gpu.queue.onSubmittedWorkDone().then(() => {
      for (const buffer of buffers) buffer.destroy();
    });
  }

  private renderTextureToView(
    texture: GPUTexture,
    view: GPUTextureView,
    record: PipelineRecord,
    targetWidth: number,
    targetHeight: number,
    outputWidth: number,
    outputHeight: number,
    projection?: DeviceProjection,
    forceNearest = false,
  ): void {
    const encoder = this.gpu.device.createCommandEncoder({ label: 'Pixelf presentation encoder' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: { a: 0, b: 0, g: 0, r: 0 },
          loadOp: 'clear',
          storeOp: 'store',
          view,
        },
      ],
      label: 'Pixelf presentation pass',
    });
    const visible = projection?.scissor !== null;
    if (visible) {
      pass.setPipeline(record.pipeline);
      if (projection !== undefined && projection.scissor !== null) {
        const { x, y, width, height } = projection.scissor;
        pass.setScissorRect(x, y, width, height);
      }
      const identity = [1, 0, 0, 1, 0, 0] as const;
      const [a, b, c, d, e, f] =
        projection === undefined
          ? identity
          : projectImagePlacement(
              identity,
              projection,
              targetWidth,
              targetHeight,
              targetWidth,
              targetHeight,
            );
      const uniform = this.uniformFor('presentation');
      this.gpu.queue.writeBuffer(
        uniform,
        0,
        new Float32Array([
          a,
          c,
          e,
          outputWidth,
          b,
          d,
          f,
          outputHeight,
          targetWidth,
          targetHeight,
          1,
          forceNearest ? 1 : 0,
        ]),
      );
      pass.setBindGroup(
        0,
        this.gpu.device.createBindGroup({
          entries: [
            { binding: 0, resource: { buffer: uniform, size: 48 } },
            { binding: 1, resource: this.linearSampler },
            { binding: 2, resource: texture.createView() },
            { binding: 3, resource: this.nearestSampler },
          ],
          layout: record.bindGroupLayout,
        }),
      );
      pass.draw(6);
    }
    pass.end();
    this.gpu.queue.submit([encoder.finish()]);
  }

  private renderToView(
    graph: Graph,
    view: GPUTextureView,
    record: PipelineRecord,
    width: number,
    height: number,
    projection?: DeviceProjection,
  ): void {
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
    if (projection?.scissor !== undefined && projection.scissor !== null) {
      const { x, y, width: scissorWidth, height: scissorHeight } = projection.scissor;
      pass.setScissorRect(x, y, scissorWidth, scissorHeight);
    }
    const activeUniforms = new Set<string>();
    const visibleEntities = projection?.scissor === null ? [] : graph.entities;
    for (const entity of visibleEntities) {
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
      const [a, b, c, d, e, f] =
        projection === undefined
          ? placement(entity)
          : projectImagePlacement(
              placement(entity),
              projection,
              entity.w,
              entity.h,
              entity.source.width,
              entity.source.height,
            );
      this.gpu.queue.writeBuffer(
        uniform,
        0,
        new Float32Array([a, c, e, width, b, d, f, height, entity.w, entity.h, entity.opacity, 0]),
      );
      const texture = textureForImage(this.gpu, this.textures, entity.source);
      const bindGroup = this.gpu.device.createBindGroup({
        entries: [
          { binding: 0, resource: { buffer: uniform, size: 48 } },
          { binding: 1, resource: this.linearSampler },
          { binding: 2, resource: texture.createView() },
          { binding: 3, resource: this.nearestSampler },
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

  private mipPipelineFor(format: GPUTextureFormat): Promise<PipelineRecord> {
    let pending = this.mipPipelines.get(format);
    if (pending !== undefined) return pending;
    pending = this.createMipPipeline(format);
    this.mipPipelines.set(format, pending);
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
        {
          binding: 3,
          sampler: { type: 'filtering' },
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

  private async createMipPipeline(format: GPUTextureFormat): Promise<PipelineRecord> {
    const module = this.gpu.device.createShaderModule({
      code: MIP_SHADER,
      label: 'Pixelf box mips',
    });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error');
    if (errors.length > 0) throw new ShaderCompilationError(errors);
    const bindGroupLayout = this.gpu.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          buffer: { minBindingSize: 16, type: 'uniform' },
          visibility: GPUShaderStage.FRAGMENT,
        },
        {
          binding: 1,
          texture: { sampleType: 'float', viewDimension: '2d' },
          visibility: GPUShaderStage.FRAGMENT,
        },
      ],
      label: 'Pixelf mip bindings',
    });
    const pipelineLayout = this.gpu.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });
    const pipeline = this.gpu.device.createRenderPipeline({
      fragment: {
        entryPoint: 'mipFragment',
        module,
        targets: [{ format }],
      },
      label: `Pixelf box mip pipeline (${format})`,
      layout: pipelineLayout,
      primitive: { topology: 'triangle-list' },
      vertex: { entryPoint: 'mipVertex', module },
    });
    return { bindGroupLayout, pipeline };
  }
}
