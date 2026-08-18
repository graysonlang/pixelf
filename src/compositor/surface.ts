import type { BlendMode } from './graph.js';

export interface Region {
  h: number;
  w: number;
  x: number;
  y: number;
}

export interface Surface {
  data: Float32Array;
  region: Region;
}

export function makeSurface(region: Region): Surface {
  if (![region.x, region.y, region.w, region.h].every(Number.isInteger)) {
    throw new Error('Surface regions must use integer pixel coordinates');
  }
  if (region.w < 0 || region.h < 0) throw new Error('Surface dimensions cannot be negative');
  return { data: new Float32Array(region.w * region.h * 4), region: { ...region } };
}

export function expandRegion(region: Region, radius: number): Region {
  const amount = Math.max(0, Math.ceil(radius));
  return {
    h: region.h + amount * 2,
    w: region.w + amount * 2,
    x: region.x - amount,
    y: region.y - amount,
  };
}

export function intersectRegion(left: Region, right: Region): Region | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.w, right.x + right.w);
  const bottomEdge = Math.min(left.y + left.h, right.y + right.h);
  if (rightEdge <= x || bottomEdge <= y) return null;
  return { h: bottomEdge - y, w: rightEdge - x, x, y };
}

export function readPremul(surface: Surface, x: number, y: number, output: Float32Array): void {
  const localX = x - surface.region.x;
  const localY = y - surface.region.y;
  if (localX < 0 || localY < 0 || localX >= surface.region.w || localY >= surface.region.h) {
    output.fill(0);
    return;
  }
  const offset = (localY * surface.region.w + localX) * 4;
  output[0] = surface.data[offset] ?? 0;
  output[1] = surface.data[offset + 1] ?? 0;
  output[2] = surface.data[offset + 2] ?? 0;
  output[3] = surface.data[offset + 3] ?? 0;
}

function blendChannel(mode: BlendMode, backdrop: number, source: number): number {
  switch (mode) {
    case 'normal':
      return source;
    case 'multiply':
      return backdrop * source;
    case 'screen':
      return backdrop + source - backdrop * source;
    case 'overlay':
      return backdrop <= 0.5 ? 2 * backdrop * source : 1 - 2 * (1 - backdrop) * (1 - source);
    case 'darken':
      return Math.min(backdrop, source);
    case 'lighten':
      return Math.max(backdrop, source);
    case 'add':
      return Math.min(1, backdrop + source);
  }
}

export function blendOnto(backdrop: Surface, source: Surface, mode: BlendMode): void {
  if (
    backdrop.region.x !== source.region.x ||
    backdrop.region.y !== source.region.y ||
    backdrop.region.w !== source.region.w ||
    backdrop.region.h !== source.region.h
  ) {
    throw new Error('Blend surfaces must cover the same region');
  }
  for (let offset = 0; offset < backdrop.data.length; offset += 4) {
    const sourceAlpha = source.data[offset + 3] ?? 0;
    const backdropAlpha = backdrop.data[offset + 3] ?? 0;
    const outputAlpha = sourceAlpha + backdropAlpha - sourceAlpha * backdropAlpha;
    for (let channel = 0; channel < 3; channel += 1) {
      const sourcePremul = source.data[offset + channel] ?? 0;
      const backdropPremul = backdrop.data[offset + channel] ?? 0;
      const sourceStraight = sourceAlpha > 0 ? sourcePremul / sourceAlpha : 0;
      const backdropStraight = backdropAlpha > 0 ? backdropPremul / backdropAlpha : 0;
      const blended = blendChannel(mode, backdropStraight, sourceStraight);
      backdrop.data[offset + channel] =
        (1 - sourceAlpha) * backdropPremul +
        (1 - backdropAlpha) * sourcePremul +
        sourceAlpha * backdropAlpha * blended;
    }
    backdrop.data[offset + 3] = outputAlpha;
  }
}

export function over(backdrop: Surface, source: Surface): void {
  blendOnto(backdrop, source, 'normal');
}

export function cropSurface(surface: Surface, region: Region): Surface {
  const output = makeSurface(region);
  const pixel = new Float32Array(4);
  for (let y = 0; y < region.h; y += 1) {
    for (let x = 0; x < region.w; x += 1) {
      readPremul(surface, region.x + x, region.y + y, pixel);
      output.data.set(pixel, (y * region.w + x) * 4);
    }
  }
  return output;
}
