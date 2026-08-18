import type { ImageSource } from './graph.js';

export interface MipLevel {
  data: Float32Array;
  height: number;
  width: number;
}

const chains = new WeakMap<Float32Array, { revision: string; levels: MipLevel[] }>();

function premultiply(source: ImageSource): MipLevel {
  const data = new Float32Array(source.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = source.data[offset + 3] ?? 0;
    data[offset] = (source.data[offset] ?? 0) * alpha;
    data[offset + 1] = (source.data[offset + 1] ?? 0) * alpha;
    data[offset + 2] = (source.data[offset + 2] ?? 0) * alpha;
    data[offset + 3] = alpha;
  }
  return { data, height: source.height, width: source.width };
}

function downsample(level: MipLevel): MipLevel {
  const width = Math.max(1, Math.floor(level.width / 2));
  const height = Math.max(1, Math.floor(level.height / 2));
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY0 = Math.floor((y * level.height) / height);
    const sourceY1 = Math.max(sourceY0 + 1, Math.floor(((y + 1) * level.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX0 = Math.floor((x * level.width) / width);
      const sourceX1 = Math.max(sourceX0 + 1, Math.floor(((x + 1) * level.width) / width));
      const count = (sourceX1 - sourceX0) * (sourceY1 - sourceY0);
      const outputOffset = (y * width + x) * 4;
      for (let sourceY = sourceY0; sourceY < sourceY1; sourceY += 1) {
        for (let sourceX = sourceX0; sourceX < sourceX1; sourceX += 1) {
          const sourceOffset = (sourceY * level.width + sourceX) * 4;
          for (let channel = 0; channel < 4; channel += 1) {
            data[outputOffset + channel] =
              (data[outputOffset + channel] ?? 0) +
              (level.data[sourceOffset + channel] ?? 0) / count;
          }
        }
      }
    }
  }
  return { data, height, width };
}

export function mipChainFor(source: ImageSource): readonly MipLevel[] {
  const cached = chains.get(source.data);
  if (cached?.revision === source.revision) return cached.levels;
  const levels = [premultiply(source)];
  while ((levels.at(-1)?.width ?? 1) > 1 || (levels.at(-1)?.height ?? 1) > 1) {
    const previous = levels.at(-1);
    if (previous === undefined) break;
    levels.push(downsample(previous));
  }
  chains.set(source.data, { levels, revision: source.revision });
  return levels;
}

export function sampleMipLevel(
  level: MipLevel,
  sourceWidth: number,
  sourceHeight: number,
  u: number,
  v: number,
  output: Float32Array,
): void {
  const x = Math.min(level.width - 1, Math.max(0, (u * level.width) / sourceWidth - 0.5));
  const y = Math.min(level.height - 1, Math.max(0, (v * level.height) / sourceHeight - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(level.width - 1, x0 + 1);
  const y1 = Math.min(level.height - 1, y0 + 1);
  const fractionX = x - x0;
  const fractionY = y - y0;
  for (let channel = 0; channel < 4; channel += 1) {
    const topLeft = level.data[(y0 * level.width + x0) * 4 + channel] ?? 0;
    const topRight = level.data[(y0 * level.width + x1) * 4 + channel] ?? 0;
    const bottomLeft = level.data[(y1 * level.width + x0) * 4 + channel] ?? 0;
    const bottomRight = level.data[(y1 * level.width + x1) * 4 + channel] ?? 0;
    output[channel] =
      (topLeft * (1 - fractionX) + topRight * fractionX) * (1 - fractionY) +
      (bottomLeft * (1 - fractionX) + bottomRight * fractionX) * fractionY;
  }
}

export function sampleImageMip(
  source: ImageSource,
  u: number,
  v: number,
  lod: number,
  output: Float32Array,
): void {
  const levels = mipChainFor(source);
  const boundedLod = Math.max(0, Math.min(levels.length - 1, lod));
  const lowIndex = Math.floor(boundedLod);
  const highIndex = Math.min(levels.length - 1, lowIndex + 1);
  const low = levels[lowIndex];
  const high = levels[highIndex];
  if (low === undefined || high === undefined) throw new Error('Image mip chain is empty');
  const lowPixel = new Float32Array(4);
  const highPixel = new Float32Array(4);
  sampleMipLevel(low, source.width, source.height, u, v, lowPixel);
  sampleMipLevel(high, source.width, source.height, u, v, highPixel);
  const fraction = boundedLod - lowIndex;
  for (let channel = 0; channel < 4; channel += 1) {
    output[channel] =
      (lowPixel[channel] ?? 0) * (1 - fraction) + (highPixel[channel] ?? 0) * fraction;
  }
}
