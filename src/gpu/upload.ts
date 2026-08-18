import type { ImageSource } from '../compositor/graph.js';
import { mipChainFor, type MipLevel } from '../compositor/mips.js';
import type { GpuContext } from './device.js';
import type { ResourcePool } from './resources.js';

export interface ByteMipLevel {
  data: Uint8Array<ArrayBuffer>;
  height: number;
  width: number;
}

function linearToSrgb(value: number): number {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded <= 0.0031308 ? bounded * 12.92 : 1.055 * bounded ** (1 / 2.4) - 0.055;
}

function encodePremultipliedLevel(level: MipLevel): ByteMipLevel {
  const data = new Uint8Array(level.data.length);
  for (let offset = 0; offset < level.data.length; offset += 4) {
    data[offset] = Math.round(linearToSrgb(level.data[offset] ?? 0) * 255);
    data[offset + 1] = Math.round(linearToSrgb(level.data[offset + 1] ?? 0) * 255);
    data[offset + 2] = Math.round(linearToSrgb(level.data[offset + 2] ?? 0) * 255);
    data[offset + 3] = Math.round(Math.max(0, Math.min(1, level.data[offset + 3] ?? 0)) * 255);
  }
  return { data, height: level.height, width: level.width };
}

export function premultipliedSrgbMipLevels(source: ImageSource): readonly ByteMipLevel[] {
  return mipChainFor(source).map(encodePremultipliedLevel);
}

export function imageTextureKey(source: ImageSource): string {
  return `image:${source.width}x${source.height}:${source.revision}`;
}

export function uploadImageTexture(
  gpu: GpuContext,
  source: ImageSource,
): { bytes: number; texture: GPUTexture } {
  const levels = premultipliedSrgbMipLevels(source);
  const texture = gpu.device.createTexture({
    format: 'rgba8unorm-srgb',
    mipLevelCount: levels.length,
    size: { height: source.height, width: source.width },
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });
  let bytes = 0;
  levels.forEach((level, mipLevel) => {
    gpu.queue.writeTexture(
      { mipLevel, texture },
      level.data,
      { bytesPerRow: level.width * 4, rowsPerImage: level.height },
      { height: level.height, width: level.width },
    );
    bytes += level.data.byteLength;
  });
  return { bytes, texture };
}

export function textureForImage(
  gpu: GpuContext,
  pool: ResourcePool<GPUTexture>,
  source: ImageSource,
): GPUTexture {
  const key = imageTextureKey(source);
  const cached = pool.get(key);
  if (cached !== undefined) return cached;
  const uploaded = uploadImageTexture(gpu, source);
  pool.set(key, uploaded.texture, uploaded.bytes);
  return uploaded.texture;
}
