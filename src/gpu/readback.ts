import type { Surface } from '../compositor/surface.js';

export function alignTo(value: number, alignment: number): number {
  if (!Number.isInteger(value) || value < 0)
    throw new Error('Value must be a non-negative integer');
  if (!Number.isInteger(alignment) || alignment <= 0) {
    throw new Error('Alignment must be a positive integer');
  }
  return Math.ceil(value / alignment) * alignment;
}

export function stripPaddedRows(
  source: Uint8Array,
  width: number,
  height: number,
  paddedBytesPerRow: number,
): Uint8Array {
  const tightBytesPerRow = width * 4;
  if (source.byteLength < paddedBytesPerRow * height) {
    throw new Error('Readback buffer is shorter than its declared rows');
  }
  const output = new Uint8Array(tightBytesPerRow * height);
  for (let row = 0; row < height; row += 1) {
    output.set(
      source.subarray(row * paddedBytesPerRow, row * paddedBytesPerRow + tightBytesPerRow),
      row * tightBytesPerRow,
    );
  }
  return output;
}

function linearToSrgbByte(value: number): number {
  const bounded = Math.max(0, Math.min(1, value));
  const encoded = bounded <= 0.0031308 ? bounded * 12.92 : 1.055 * bounded ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

export function referenceSurfaceBytes(surface: Surface): Uint8Array {
  const output = new Uint8Array(surface.data.length);
  for (let offset = 0; offset < surface.data.length; offset += 4) {
    output[offset] = linearToSrgbByte(surface.data[offset] ?? 0);
    output[offset + 1] = linearToSrgbByte(surface.data[offset + 1] ?? 0);
    output[offset + 2] = linearToSrgbByte(surface.data[offset + 2] ?? 0);
    output[offset + 3] = Math.round(Math.max(0, Math.min(1, surface.data[offset + 3] ?? 0)) * 255);
  }
  return output;
}

export interface ByteComparison {
  comparedPixels: number;
  maximumColorDifference: number;
}

export function compareGpuBytesToReference(
  gpuBytes: Uint8Array,
  reference: Surface,
  colorTolerance = 2,
): ByteComparison {
  const referenceBytes = referenceSurfaceBytes(reference);
  if (gpuBytes.length !== referenceBytes.length) throw new Error('GPU and reference sizes differ');
  let maximumColorDifference = 0;
  for (let offset = 0; offset < gpuBytes.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(
        (gpuBytes[offset + channel] ?? 0) - (referenceBytes[offset + channel] ?? 0),
      );
      maximumColorDifference = Math.max(maximumColorDifference, difference);
      if (difference > colorTolerance) {
        throw new Error(`GPU color differs by ${difference} at byte ${offset + channel}`);
      }
    }
    if (gpuBytes[offset + 3] !== referenceBytes[offset + 3]) {
      throw new Error(`GPU alpha differs at byte ${offset + 3}`);
    }
  }
  return { comparedPixels: gpuBytes.length / 4, maximumColorDifference };
}
