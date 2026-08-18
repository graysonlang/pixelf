import { applyEffect, effectInputRegion } from './effects.js';
import type { Entity, Graph } from './graph.js';
import { rasterSource } from './source.js';
import { blendOnto, makeSurface, type Region, type Surface } from './surface.js';

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
  return surface;
}

export function renderRegion(graph: Graph, output: Region, scale: number): Surface {
  const accumulator = makeSurface(output);
  for (const entity of graph.entities) {
    blendOnto(accumulator, evalEntity(entity, output, scale), entity.blend);
  }
  return accumulator;
}
