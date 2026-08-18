import type { Surface } from '../compositor/surface.js';

export interface SurfaceAnalysis {
  alphaCoverage: number;
  histogram: {
    alpha: Uint32Array;
    blue: Uint32Array;
    green: Uint32Array;
    luma: Uint32Array;
    red: Uint32Array;
  };
  mean: readonly [number, number, number, number];
  vectorscope: readonly { count: number; u: number; v: number }[];
}

function bin(value: number, bins: number): number {
  return Math.min(bins - 1, Math.max(0, Math.floor(value * bins)));
}

function increment(values: Uint32Array, index: number): void {
  values[index] = (values[index] ?? 0) + 1;
}

export function analyzeSurface(surface: Surface, bins = 256): SurfaceAnalysis {
  if (!Number.isInteger(bins) || bins < 2 || bins > 4096) {
    throw new Error('Analysis bin count must be an integer from 2 through 4096');
  }
  const histogram = {
    alpha: new Uint32Array(bins),
    blue: new Uint32Array(bins),
    green: new Uint32Array(bins),
    luma: new Uint32Array(bins),
    red: new Uint32Array(bins),
  };
  const totals: [number, number, number, number] = [0, 0, 0, 0];
  const scope = new Map<string, { count: number; u: number; v: number }>();
  let covered = 0;
  const pixelCount = surface.region.w * surface.region.h;
  for (let offset = 0; offset < surface.data.length; offset += 4) {
    const alpha = Math.max(0, Math.min(1, surface.data[offset + 3] ?? 0));
    const red = alpha > 0 ? (surface.data[offset] ?? 0) / alpha : 0;
    const green = alpha > 0 ? (surface.data[offset + 1] ?? 0) / alpha : 0;
    const blue = alpha > 0 ? (surface.data[offset + 2] ?? 0) / alpha : 0;
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    increment(histogram.red, bin(red, bins));
    increment(histogram.green, bin(green, bins));
    increment(histogram.blue, bin(blue, bins));
    increment(histogram.alpha, bin(alpha, bins));
    increment(histogram.luma, bin(luma, bins));
    totals[0] += red;
    totals[1] += green;
    totals[2] += blue;
    totals[3] += alpha;
    if (alpha > 0) covered += 1;
    const u = Math.round((blue - luma) * 32) / 32;
    const v = Math.round((red - luma) * 32) / 32;
    const key = `${u}:${v}`;
    const sample = scope.get(key);
    if (sample === undefined) scope.set(key, { count: 1, u, v });
    else sample.count += 1;
  }
  const divisor = Math.max(1, pixelCount);
  return {
    alphaCoverage: covered / divisor,
    histogram,
    mean: [totals[0] / divisor, totals[1] / divisor, totals[2] / divisor, totals[3] / divisor],
    vectorscope: [...scope.values()].sort((left, right) => right.count - left.count),
  };
}
