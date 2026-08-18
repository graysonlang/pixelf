import { applyEffect, effectInputRegion } from './effects.js';
import type { Entity, Graph } from './graph.js';
import { rasterSource } from './source.js';
import { blendOnto, makeSurface, readPremul, type Region, type Surface } from './surface.js';

export function evalEntity(entity: Entity, output: Region, scale: number): Surface {
  const regions = new Array<Region>(entity.effects.length + 1);
  regions[entity.effects.length] = output;
  for (let index = entity.effects.length - 1; index >= 0; index -= 1) {
    const effect = entity.effects[index];
    const effectOutput = regions[index + 1];
    if (effect === undefined || effectOutput === undefined) throw new Error('Invalid effect chain');
    regions[index] = effectInputRegion(effect, effectOutput, scale);
  }
  const sourceRegion = regions[0];
  if (sourceRegion === undefined) throw new Error('Missing source region');
  let surface = rasterSource(entity, sourceRegion, scale);
  for (let index = 0; index < entity.effects.length; index += 1) {
    const effect = entity.effects[index];
    const effectOutput = regions[index + 1];
    if (effect === undefined || effectOutput === undefined) throw new Error('Invalid effect chain');
    surface = applyEffect(effect, surface, effectOutput, scale);
  }
  if (entity.mask === undefined) return surface;
  const mask = evalEntity(
    {
      blend: 'normal',
      effects: entity.mask.effects,
      h: entity.mask.h,
      id: `${entity.id}:mask`,
      matrix: entity.mask.matrix,
      opacity: 1,
      source: entity.mask.source,
      w: entity.mask.w,
      x: entity.mask.x,
      y: entity.mask.y,
    },
    output,
    scale,
  );
  const maskPixel = new Float32Array(4);
  for (let y = 0; y < output.h; y += 1) {
    for (let x = 0; x < output.w; x += 1) {
      readPremul(mask, output.x + x, output.y + y, maskPixel);
      const value =
        (maskPixel[0] ?? 0) * 0.2126 + (maskPixel[1] ?? 0) * 0.7152 + (maskPixel[2] ?? 0) * 0.0722;
      const inverted = entity.mask.invert ? 1 - value : value;
      const amount = Math.max(0, Math.min(1, inverted * entity.mask.density));
      const offset = (y * output.w + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        surface.data[offset + channel] = (surface.data[offset + channel] ?? 0) * amount;
      }
    }
  }
  return surface;
}

export function renderRegion(graph: Graph, output: Region, scale: number): Surface {
  const accumulator = makeSurface(output);
  for (const entity of graph.entities) {
    blendOnto(accumulator, evalEntity(entity, output, scale), entity.blend);
  }
  return accumulator;
}
