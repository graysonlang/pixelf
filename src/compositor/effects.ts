import type {
  AffineEffect,
  BlurEffect,
  ChannelEffect,
  CompositeEffect,
  ContrastEffect,
  Effect,
  ExposureEffect,
  LevelsEffect,
  SaturationEffect,
  SharpenEffect,
  WhiteBalanceEffect,
} from './graph.js';
import { rasterSource } from './source.js';
import {
  blendOnto,
  cropSurface,
  expandRegion,
  makeSurface,
  readPremul,
  type Region,
  type Surface,
} from './surface.js';

export function effectHalo(effect: Effect, scale: number): number {
  if (effect.kind === 'blur') return Math.ceil(Math.max(0, effect.sigma) * scale * 3);
  if (effect.kind === 'sharpen') return Math.ceil(Math.max(0, effect.radius) * scale * 3);
  return 0;
}

export function effectInputRegion(effect: Effect, output: Region, scale: number): Region {
  if (effect.kind === 'affine') return affineInputRegion(effect, output, scale);
  return expandRegion(output, effectHalo(effect, scale));
}

function inverseAffinePoint(
  effect: AffineEffect,
  x: number,
  y: number,
): { x: number; y: number } | null {
  if (Math.abs(effect.scaleX) < 1e-12 || Math.abs(effect.scaleY) < 1e-12) return null;
  const translatedX = x - effect.x - effect.pivotX;
  const translatedY = y - effect.y - effect.pivotY;
  const radians = (-effect.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: (cosine * translatedX - sine * translatedY) / effect.scaleX + effect.pivotX,
    y: (sine * translatedX + cosine * translatedY) / effect.scaleY + effect.pivotY,
  };
}

function affineInputRegion(effect: AffineEffect, output: Region, scale: number): Region {
  const corners = [
    inverseAffinePoint(effect, output.x / scale, output.y / scale),
    inverseAffinePoint(effect, (output.x + output.w) / scale, output.y / scale),
    inverseAffinePoint(effect, output.x / scale, (output.y + output.h) / scale),
    inverseAffinePoint(effect, (output.x + output.w) / scale, (output.y + output.h) / scale),
  ].filter(point => point !== null);
  if (corners.length === 0) return { h: 0, w: 0, x: output.x, y: output.y };
  const xs = corners.map(point => point.x * scale);
  const ys = corners.map(point => point.y * scale);
  const x = Math.floor(Math.min(...xs)) - 1;
  const y = Math.floor(Math.min(...ys)) - 1;
  const right = Math.ceil(Math.max(...xs)) + 1;
  const bottom = Math.ceil(Math.max(...ys)) + 1;
  return { h: bottom - y, w: right - x, x, y };
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

type StraightMapper = (r: number, g: number, b: number, a: number) => readonly number[];

function mapStraight(input: Surface, outputRegion: Region, mapper: StraightMapper): Surface {
  const output = makeSurface(outputRegion);
  const pixel = new Float32Array(4);
  for (let y = 0; y < outputRegion.h; y += 1) {
    for (let x = 0; x < outputRegion.w; x += 1) {
      readPremul(input, outputRegion.x + x, outputRegion.y + y, pixel);
      const alpha = pixel[3] ?? 0;
      if (alpha <= 0) continue;
      const mapped = mapper(
        (pixel[0] ?? 0) / alpha,
        (pixel[1] ?? 0) / alpha,
        (pixel[2] ?? 0) / alpha,
        alpha,
      );
      const offset = (y * outputRegion.w + x) * 4;
      output.data[offset] = Math.max(0, mapped[0] ?? 0) * alpha;
      output.data[offset + 1] = Math.max(0, mapped[1] ?? 0) * alpha;
      output.data[offset + 2] = Math.max(0, mapped[2] ?? 0) * alpha;
      output.data[offset + 3] = alpha;
    }
  }
  return output;
}

function applyExposure(effect: ExposureEffect, input: Surface, output: Region): Surface {
  const gain = 2 ** effect.stops;
  return mapStraight(input, output, (r, g, b) => [r * gain, g * gain, b * gain]);
}

function applyWhiteBalance(effect: WhiteBalanceEffect, input: Surface, output: Region): Surface {
  const warm = Math.max(-1, Math.min(1, effect.temperature));
  const tint = Math.max(-1, Math.min(1, effect.tint));
  return mapStraight(input, output, (r, g, b) => [
    r * (1 + warm * 0.25 - tint * 0.05),
    g * (1 + tint * 0.2),
    b * (1 - warm * 0.25 - tint * 0.05),
  ]);
}

function applyContrast(effect: ContrastEffect, input: Surface, output: Region): Surface {
  const gain = Math.max(0, 1 + effect.amount);
  return mapStraight(input, output, (r, g, b) => [
    (r - 0.5) * gain + 0.5,
    (g - 0.5) * gain + 0.5,
    (b - 0.5) * gain + 0.5,
  ]);
}

function applySaturation(effect: SaturationEffect, input: Surface, output: Region): Surface {
  return mapStraight(input, output, (r, g, b) => {
    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    return [
      luminance + (r - luminance) * effect.amount,
      luminance + (g - luminance) * effect.amount,
      luminance + (b - luminance) * effect.amount,
    ];
  });
}

function applyChannel(effect: ChannelEffect, input: Surface, output: Region): Surface {
  if (effect.channel === 'rgba') return cropSurface(input, output);
  return mapStraight(input, output, (r, g, b, a) => {
    const value =
      effect.channel === 'red'
        ? r
        : effect.channel === 'green'
          ? g
          : effect.channel === 'blue'
            ? b
            : effect.channel === 'alpha'
              ? a
              : r * 0.2126 + g * 0.7152 + b * 0.0722;
    return [value, value, value];
  });
}

function applyComposite(
  effect: CompositeEffect,
  input: Surface,
  outputRegion: Region,
  scale: number,
): Surface {
  const output = cropSurface(input, outputRegion);
  const secondary = rasterSource(
    {
      blend: effect.blend,
      effects: [],
      h: effect.height,
      id: 'composite-secondary',
      opacity: effect.opacity,
      source: effect.source,
      w: effect.width,
      x: 0,
      y: 0,
    },
    outputRegion,
    scale,
  );
  blendOnto(output, secondary, effect.blend);
  return output;
}

function applyBounds(
  input: Surface,
  outputRegion: Region,
  bounds: { height: number; width: number; x: number; y: number },
  scale: number,
): Surface {
  const output = cropSurface(input, outputRegion);
  const left = bounds.x * scale;
  const top = bounds.y * scale;
  const right = (bounds.x + bounds.width) * scale;
  const bottom = (bounds.y + bounds.height) * scale;
  for (let y = 0; y < output.region.h; y += 1) {
    for (let x = 0; x < output.region.w; x += 1) {
      const worldX = output.region.x + x + 0.5;
      const worldY = output.region.y + y + 0.5;
      if (worldX >= left && worldX < right && worldY >= top && worldY < bottom) continue;
      output.data.fill(0, (y * output.region.w + x) * 4, (y * output.region.w + x + 1) * 4);
    }
  }
  return output;
}

function applyAffine(
  effect: AffineEffect,
  input: Surface,
  outputRegion: Region,
  scale: number,
): Surface {
  const output = makeSurface(outputRegion);
  const pixel = new Float32Array(4);
  for (let y = 0; y < outputRegion.h; y += 1) {
    for (let x = 0; x < outputRegion.w; x += 1) {
      const sourcePoint = inverseAffinePoint(
        effect,
        (outputRegion.x + x + 0.5) / scale,
        (outputRegion.y + y + 0.5) / scale,
      );
      if (sourcePoint === null) continue;
      readPremul(
        input,
        Math.floor(sourcePoint.x * scale),
        Math.floor(sourcePoint.y * scale),
        pixel,
      );
      output.data.set(pixel, (y * outputRegion.w + x) * 4);
    }
  }
  return output;
}

function applySharpen(
  effect: SharpenEffect,
  input: Surface,
  outputRegion: Region,
  scale: number,
): Surface {
  const blurred = applyBlur({ kind: 'blur', sigma: effect.radius }, input, outputRegion, scale);
  const output = makeSurface(outputRegion);
  const original = new Float32Array(4);
  for (let y = 0; y < outputRegion.h; y += 1) {
    for (let x = 0; x < outputRegion.w; x += 1) {
      readPremul(input, outputRegion.x + x, outputRegion.y + y, original);
      const offset = (y * outputRegion.w + x) * 4;
      const alpha = original[3] ?? 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const value =
          (original[channel] ?? 0) +
          ((original[channel] ?? 0) - (blurred.data[offset + channel] ?? 0)) * effect.amount;
        output.data[offset + channel] = Math.max(0, Math.min(alpha, value));
      }
      output.data[offset + 3] = alpha;
    }
  }
  return output;
}

export function applyEffect(
  effect: Effect,
  input: Surface,
  outputRegion: Region,
  scale: number,
): Surface {
  switch (effect.kind) {
    case 'affine':
      return applyAffine(effect, input, outputRegion, scale);
    case 'blur':
      return applyBlur(effect, input, outputRegion, scale);
    case 'canvas-resize':
    case 'crop':
      return applyBounds(input, outputRegion, effect, scale);
    case 'channel':
      return applyChannel(effect, input, outputRegion);
    case 'composite':
      return applyComposite(effect, input, outputRegion, scale);
    case 'contrast':
      return applyContrast(effect, input, outputRegion);
    case 'exposure':
      return applyExposure(effect, input, outputRegion);
    case 'levels':
      return applyLevels(effect, cropSurface(input, outputRegion));
    case 'saturation':
      return applySaturation(effect, input, outputRegion);
    case 'sharpen':
      return applySharpen(effect, input, outputRegion, scale);
    case 'white-balance':
      return applyWhiteBalance(effect, input, outputRegion);
  }
}
