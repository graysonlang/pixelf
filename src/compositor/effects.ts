import type { BlurEffect, Effect, LevelsEffect } from './graph.js';
import { expandRegion, makeSurface, readPremul, type Region, type Surface } from './surface.js';

export function effectHalo(effect: Effect, scale: number): number {
  if (effect.kind !== 'blur' || effect.sigma <= 1e-6) return 0;
  return Math.ceil(effect.sigma * scale * 3);
}

export function effectInputRegion(effect: Effect, output: Region, scale: number): Region {
  return expandRegion(output, effectHalo(effect, scale));
}

function gaussianKernel(sigmaPixels: number): { radius: number; weights: number[] } {
  const radius = sigmaPixels <= 1e-6 ? 0 : Math.ceil(sigmaPixels * 3);
  if (radius === 0) return { radius, weights: [1] };
  const weights: number[] = [];
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigmaPixels * sigmaPixels));
    weights.push(weight);
    sum += weight;
  }
  return { radius, weights: weights.map(weight => weight / sum) };
}

function applyBlur(
  effect: BlurEffect,
  input: Surface,
  outputRegion: Region,
  scale: number,
): Surface {
  const { radius, weights } = gaussianKernel(effect.sigma * scale);
  if (radius === 0) return input;
  const temporary = makeSurface(input.region);
  const pixel = new Float32Array(4);
  for (let y = 0; y < input.region.h; y += 1) {
    for (let x = 0; x < input.region.w; x += 1) {
      const outputOffset = (y * input.region.w + x) * 4;
      for (let kernel = -radius; kernel <= radius; kernel += 1) {
        readPremul(input, input.region.x + x + kernel, input.region.y + y, pixel);
        const weight = weights[kernel + radius] ?? 0;
        for (let channel = 0; channel < 4; channel += 1) {
          temporary.data[outputOffset + channel] =
            (temporary.data[outputOffset + channel] ?? 0) + (pixel[channel] ?? 0) * weight;
        }
      }
    }
  }
  const output = makeSurface(outputRegion);
  for (let y = 0; y < outputRegion.h; y += 1) {
    for (let x = 0; x < outputRegion.w; x += 1) {
      const outputOffset = (y * outputRegion.w + x) * 4;
      for (let kernel = -radius; kernel <= radius; kernel += 1) {
        readPremul(temporary, outputRegion.x + x, outputRegion.y + y + kernel, pixel);
        const weight = weights[kernel + radius] ?? 0;
        for (let channel = 0; channel < 4; channel += 1) {
          output.data[outputOffset + channel] =
            (output.data[outputOffset + channel] ?? 0) + (pixel[channel] ?? 0) * weight;
        }
      }
    }
  }
  return output;
}

function remap(effect: LevelsEffect, value: number): number {
  const denominator = effect.inWhite - effect.inBlack || 1e-6;
  const normalized = Math.max(0, Math.min(1, (value - effect.inBlack) / denominator));
  const corrected = effect.gamma === 1 ? normalized : normalized ** (1 / effect.gamma);
  return effect.outBlack + corrected * (effect.outWhite - effect.outBlack);
}

function applyLevels(effect: LevelsEffect, input: Surface): Surface {
  const output = makeSurface(input.region);
  for (let offset = 0; offset < input.data.length; offset += 4) {
    const alpha = input.data[offset + 3] ?? 0;
    if (alpha <= 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      output.data[offset + channel] =
        remap(effect, (input.data[offset + channel] ?? 0) / alpha) * alpha;
    }
    output.data[offset + 3] = alpha;
  }
  return output;
}

export function applyEffect(
  effect: Effect,
  input: Surface,
  outputRegion: Region,
  scale: number,
): Surface {
  return effect.kind === 'blur'
    ? applyBlur(effect, input, outputRegion, scale)
    : applyLevels(effect, input);
}
