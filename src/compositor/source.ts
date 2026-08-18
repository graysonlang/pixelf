import type { Entity, EntityMatrix, ImageSource } from './graph.js';
import { sampleImageMip } from './mips.js';
import { makeSurface, type Region, type Surface } from './surface.js';

interface InversePlacement {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

function inversePlacement(entity: Entity): InversePlacement | null {
  const matrix: EntityMatrix = entity.matrix ?? [1, 0, 0, 1, entity.x, entity.y];
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-12) return null;
  return {
    a: d / determinant,
    b: -b / determinant,
    c: -c / determinant,
    d: a / determinant,
    e,
    f,
  };
}

function imageLod(
  source: ImageSource,
  entity: Entity,
  inverse: InversePlacement,
  scale: number,
): number {
  const duDx = (inverse.a * source.width) / entity.w / scale;
  const dvDx = (inverse.b * source.height) / entity.h / scale;
  const duDy = (inverse.c * source.width) / entity.w / scale;
  const dvDy = (inverse.d * source.height) / entity.h / scale;
  const footprint = Math.max(Math.hypot(duDx, dvDx), Math.hypot(duDy, dvDy), 1);
  return Math.log2(footprint);
}

export function rasterSource(entity: Entity, region: Region, scale: number): Surface {
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('Render scale must be positive');
  const output = makeSurface(region);
  if (entity.w <= 0 || entity.h <= 0 || entity.opacity <= 0) return output;
  const inverse = inversePlacement(entity);
  if (inverse === null) return output;
  const sampled = new Float32Array(4);
  const lod = entity.source.kind === 'image' ? imageLod(entity.source, entity, inverse, scale) : 0;
  for (let y = 0; y < region.h; y += 1) {
    const canonicalY = (region.y + y + 0.5) / scale;
    for (let x = 0; x < region.w; x += 1) {
      const canonicalX = (region.x + x + 0.5) / scale;
      const relativeX = canonicalX - inverse.e;
      const relativeY = canonicalY - inverse.f;
      const localX = inverse.a * relativeX + inverse.c * relativeY;
      const localY = inverse.b * relativeX + inverse.d * relativeY;
      if (localX < 0 || localY < 0 || localX >= entity.w || localY >= entity.h) continue;
      if (entity.source.kind === 'solid') {
        sampled[0] = entity.source.r * entity.source.a;
        sampled[1] = entity.source.g * entity.source.a;
        sampled[2] = entity.source.b * entity.source.a;
        sampled[3] = entity.source.a;
      } else {
        const u = (localX / entity.w) * entity.source.width;
        const v = (localY / entity.h) * entity.source.height;
        sampleImageMip(entity.source, u, v, lod, sampled);
      }
      const offset = (y * region.w + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output.data[offset + channel] = (sampled[channel] ?? 0) * entity.opacity;
      }
    }
  }
  return output;
}
