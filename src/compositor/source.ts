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
  const fill = Math.max(0, entity.fill ?? 1);
  if (entity.w <= 0 || entity.h <= 0 || fill <= 0) return output;
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
      } else if (entity.source.kind === 'checker') {
        const checkerX = Math.floor((localX + entity.source.offsetX) / entity.source.size);
        const checkerY = Math.floor((localY + entity.source.offsetY) / entity.source.size);
        const value = (checkerX + checkerY) % 2 === 0 ? entity.source.first : entity.source.second;
        sampled[0] = value;
        sampled[1] = value;
        sampled[2] = value;
        sampled[3] = 1;
      } else if (entity.source.kind === 'linear-gradient') {
        const u = localX / entity.w;
        const v = localY / entity.h;
        const deltaX = entity.source.endX - entity.source.startX;
        const deltaY = entity.source.endY - entity.source.startY;
        const lengthSquared = deltaX * deltaX + deltaY * deltaY;
        const amount =
          lengthSquared <= 1e-12
            ? 0
            : Math.max(
                0,
                Math.min(
                  1,
                  ((u - entity.source.startX) * deltaX + (v - entity.source.startY) * deltaY) /
                    lengthSquared,
                ),
              );
        const alpha =
          (entity.source.start[3] ?? 0) * (1 - amount) + (entity.source.end[3] ?? 0) * amount;
        for (let channel = 0; channel < 3; channel += 1) {
          const straight =
            (entity.source.start[channel] ?? 0) * (1 - amount) +
            (entity.source.end[channel] ?? 0) * amount;
          sampled[channel] = straight * alpha;
        }
        sampled[3] = alpha;
      } else if (entity.source.kind === 'pattern') {
        const checkerX = Math.floor((localX + entity.source.offsetX) / entity.source.size);
        const checkerY = Math.floor((localY + entity.source.offsetY) / entity.source.size);
        const color = (checkerX + checkerY) % 2 === 0 ? entity.source.first : entity.source.second;
        const alpha = color[3] ?? 0;
        sampled[0] = (color[0] ?? 0) * alpha;
        sampled[1] = (color[1] ?? 0) * alpha;
        sampled[2] = (color[2] ?? 0) * alpha;
        sampled[3] = alpha;
      } else if (entity.source.kind === 'image') {
        const u = (localX / entity.w) * entity.source.width;
        const v = (localY / entity.h) * entity.source.height;
        sampleImageMip(entity.source, u, v, lod, sampled);
      } else {
        throw new Error('Nested graph sources are evaluated by the stack renderer');
      }
      const offset = (y * region.w + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output.data[offset + channel] = (sampled[channel] ?? 0) * fill;
      }
    }
  }
  return output;
}
