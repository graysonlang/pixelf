import type {
  AffineEffect,
  BlurEffect,
  BrightnessEffect,
  ChannelEffect,
  ClarityEffect,
  CompositeEffect,
  ContrastEffect,
  Effect,
  ExposureEffect,
  GrainEffect,
  LevelsEffect,
  NoiseReductionEffect,
  SaturationEffect,
  SharpenEffect,
  TonalRangeEffect,
  VibranceEffect,
  VignetteEffect,
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
  if (
    (effect.kind === 'clarity' || effect.kind === 'noise-reduction') &&
    Math.abs(effect.amount) > 1e-6
  ) {
    return Math.ceil(Math.max(0, effect.radius) * scale * 3);
  }
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
  if (effect.edgeSampling !== 'transparent') {
    const x = Math.floor(effect.inputBounds.x * scale);
    const y = Math.floor(effect.inputBounds.y * scale);
    const right = Math.ceil((effect.inputBounds.x + effect.inputBounds.width) * scale);
    const bottom = Math.ceil((effect.inputBounds.y + effect.inputBounds.height) * scale);
    return { h: bottom - y, w: right - x, x, y };
  }
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

function sampledEdgeCoordinate(
  coordinate: number,
  start: number,
  length: number,
  sampling: AffineEffect['edgeSampling'],
): number | null {
  if (length <= 0) return null;
  const end = start + length;
  if (coordinate >= start && coordinate < end) return coordinate;
  if (sampling === 'transparent') return null;
  if (sampling === 'clamp') return Math.max(start, Math.min(end - 1, coordinate));
  const relative = coordinate - start;
  if (sampling === 'repeat') return start + (((relative % length) + length) % length);
  const period = length * 2;
  const wrapped = ((relative % period) + period) % period;
  return start + (wrapped < length ? wrapped : period - wrapped - 1);
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

function applyBrightness(effect: BrightnessEffect, input: Surface, output: Region): Surface {
  const gain = Math.max(0, 1 + effect.amount);
  return mapStraight(input, output, (r, g, b) => [r * gain, g * gain, b * gain]);
}

function applyTonalRange(effect: TonalRangeEffect, input: Surface, output: Region): Surface {
  return mapStraight(input, output, (r, g, b) => {
    const map = (value: number): number => {
      if (effect.kind === 'highlights') {
        return value > 0.5 ? 0.5 + (value - 0.5) * (1 + effect.amount / 2) : value;
      }
      if (effect.kind === 'shadows') {
        return value < 0.5 ? value * (1 + effect.amount / 2) : value;
      }
      if (effect.kind === 'whites') return value * (1 + effect.amount / 2);
      return value + effect.amount * (80 / 255);
    };
    return [map(r), map(g), map(b)];
  });
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

function applyVibrance(effect: VibranceEffect, input: Surface, output: Region): Surface {
  return mapStraight(input, output, (r, g, b) => {
    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const gain =
      effect.amount >= 0
        ? 1 + effect.amount * (1 - Math.max(0, Math.min(1, chroma)))
        : 1 + effect.amount;
    return [
      luminance + (r - luminance) * gain,
      luminance + (g - luminance) * gain,
      luminance + (b - luminance) * gain,
    ];
  });
}

function mixSurfaces(original: Surface, adjusted: Surface, amount: number): Surface {
  const output = makeSurface(adjusted.region);
  const source = new Float32Array(4);
  for (let y = 0; y < adjusted.region.h; y += 1) {
    for (let x = 0; x < adjusted.region.w; x += 1) {
      readPremul(original, adjusted.region.x + x, adjusted.region.y + y, source);
      const offset = (y * adjusted.region.w + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output.data[offset + channel] =
          (source[channel] ?? 0) * (1 - amount) + (adjusted.data[offset + channel] ?? 0) * amount;
      }
    }
  }
  return output;
}

function applyClarity(
  effect: ClarityEffect,
  input: Surface,
  outputRegion: Region,
  scale: number,
): Surface {
  if (Math.abs(effect.amount) <= 1e-6) return cropSurface(input, outputRegion);
  const blurred = applyBlur({ kind: 'blur', sigma: effect.radius }, input, outputRegion, scale);
  const output = makeSurface(outputRegion);
  const original = new Float32Array(4);
  for (let y = 0; y < outputRegion.h; y += 1) {
    for (let x = 0; x < outputRegion.w; x += 1) {
      readPremul(input, outputRegion.x + x, outputRegion.y + y, original);
      const offset = (y * outputRegion.w + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        output.data[offset + channel] = Math.max(
          0,
          (original[channel] ?? 0) +
            ((original[channel] ?? 0) - (blurred.data[offset + channel] ?? 0)) *
              effect.amount *
              1.5,
        );
      }
      output.data[offset + 3] = original[3] ?? 0;
    }
  }
  return output;
}

function applyNoiseReduction(
  effect: NoiseReductionEffect,
  input: Surface,
  outputRegion: Region,
  scale: number,
): Surface {
  if (effect.amount <= 1e-6) return cropSurface(input, outputRegion);
  const blurred = applyBlur({ kind: 'blur', sigma: effect.radius }, input, outputRegion, scale);
  return mixSurfaces(input, blurred, Math.max(0, Math.min(1, effect.amount)));
}

function noiseAt(x: number, y: number, seed: number): number {
  let value =
    Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(y | 0, 0x5f356495) ^ Math.imul(seed | 0, 0x68bc21eb);
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  return ((value ^ (value >>> 15)) >>> 0) / 4_294_967_296 - 0.5;
}

function applyGrain(effect: GrainEffect, input: Surface, outputRegion: Region): Surface {
  const output = cropSurface(input, outputRegion);
  const amplitude = Math.max(0, effect.amount) * 0.12;
  for (let y = 0; y < outputRegion.h; y += 1) {
    for (let x = 0; x < outputRegion.w; x += 1) {
      const offset = (y * outputRegion.w + x) * 4;
      const alpha = output.data[offset + 3] ?? 0;
      const noise =
        noiseAt(outputRegion.x + x, outputRegion.y + y, effect.seed) * amplitude * alpha;
      for (let channel = 0; channel < 3; channel += 1) {
        output.data[offset + channel] = Math.max(0, (output.data[offset + channel] ?? 0) + noise);
      }
    }
  }
  return output;
}

function applyVignette(
  effect: VignetteEffect,
  input: Surface,
  outputRegion: Region,
  scale: number,
): Surface {
  const output = cropSurface(input, outputRegion);
  const halfWidth = Math.max(1e-6, effect.width / 2);
  const halfHeight = Math.max(1e-6, effect.height / 2);
  for (let y = 0; y < outputRegion.h; y += 1) {
    for (let x = 0; x < outputRegion.w; x += 1) {
      const canonicalX = (outputRegion.x + x + 0.5) / scale;
      const canonicalY = (outputRegion.y + y + 0.5) / scale;
      const dx = (canonicalX - halfWidth) / halfWidth;
      const dy = (canonicalY - halfHeight) / halfHeight;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const edge = Math.max(0, Math.min(1, (distance - 0.35) / 0.65));
      const falloff = edge * edge * (3 - 2 * edge);
      const gain = Math.max(0, 1 - effect.amount * 0.75 * falloff);
      const offset = (y * outputRegion.w + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        output.data[offset + channel] = (output.data[offset + channel] ?? 0) * gain;
      }
    }
  }
  return output;
}

function applyOpacity(amount: number, input: Surface, outputRegion: Region): Surface {
  const output = cropSurface(input, outputRegion);
  const opacity = Math.max(0, amount);
  for (let offset = 0; offset < output.data.length; offset += 1) {
    output.data[offset] = (output.data[offset] ?? 0) * opacity;
  }
  return output;
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
      fill: effect.opacity,
      h: effect.height,
      id: 'composite-secondary',
      opacity: 1,
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
  const inputX = Math.floor(effect.inputBounds.x * scale);
  const inputY = Math.floor(effect.inputBounds.y * scale);
  const inputRight = Math.ceil((effect.inputBounds.x + effect.inputBounds.width) * scale);
  const inputBottom = Math.ceil((effect.inputBounds.y + effect.inputBounds.height) * scale);
  for (let y = 0; y < outputRegion.h; y += 1) {
    for (let x = 0; x < outputRegion.w; x += 1) {
      const sourcePoint = inverseAffinePoint(
        effect,
        (outputRegion.x + x + 0.5) / scale,
        (outputRegion.y + y + 0.5) / scale,
      );
      if (sourcePoint === null) continue;
      const sourceX = sampledEdgeCoordinate(
        Math.floor(sourcePoint.x * scale),
        inputX,
        inputRight - inputX,
        effect.edgeSampling,
      );
      const sourceY = sampledEdgeCoordinate(
        Math.floor(sourcePoint.y * scale),
        inputY,
        inputBottom - inputY,
        effect.edgeSampling,
      );
      if (sourceX === null || sourceY === null) continue;
      readPremul(input, sourceX, sourceY, pixel);
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
    case 'brightness':
      return applyBrightness(effect, input, outputRegion);
    case 'blacks':
    case 'highlights':
    case 'shadows':
    case 'whites':
      return applyTonalRange(effect, input, outputRegion);
    case 'canvas-resize':
    case 'crop':
      return applyBounds(input, outputRegion, effect, scale);
    case 'channel':
      return applyChannel(effect, input, outputRegion);
    case 'clarity':
      return applyClarity(effect, input, outputRegion, scale);
    case 'composite':
      return applyComposite(effect, input, outputRegion, scale);
    case 'contrast':
      return applyContrast(effect, input, outputRegion);
    case 'exposure':
      return applyExposure(effect, input, outputRegion);
    case 'grain':
      return applyGrain(effect, input, outputRegion);
    case 'levels':
      return applyLevels(effect, cropSurface(input, outputRegion));
    case 'noise-reduction':
      return applyNoiseReduction(effect, input, outputRegion, scale);
    case 'opacity':
      return applyOpacity(effect.amount, input, outputRegion);
    case 'saturation':
      return applySaturation(effect, input, outputRegion);
    case 'sharpen':
      return applySharpen(effect, input, outputRegion, scale);
    case 'vibrance':
      return applyVibrance(effect, input, outputRegion);
    case 'vignette':
      return applyVignette(effect, input, outputRegion, scale);
    case 'white-balance':
      return applyWhiteBalance(effect, input, outputRegion);
  }
}
