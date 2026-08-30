import { applyEffect, effectInputRegion } from './effects.js';
import type { Entity, Graph, GraphFilter } from './graph.js';
import { rasterSource } from './source.js';
import {
  blendOnto,
  cropSurface,
  makeSurface,
  readPremul,
  type Region,
  type Surface,
} from './surface.js';

function evaluateMask(
  ownerId: string,
  mask: NonNullable<Entity['mask']>,
  output: Region,
  scale: number,
): Surface {
  return evalEntity(
    {
      blend: 'normal',
      effects: mask.effects,
      fill: 1,
      h: mask.h,
      id: `${ownerId}:mask`,
      matrix: mask.matrix,
      opacity: 1,
      source: mask.source,
      w: mask.w,
      x: mask.x,
      y: mask.y,
    },
    output,
    scale,
  );
}

function maskAmount(
  mask: NonNullable<Entity['mask']>,
  maskSurface: Surface,
  x: number,
  y: number,
  pixel: Float32Array,
): number {
  readPremul(maskSurface, x, y, pixel);
  const value = (pixel[0] ?? 0) * 0.2126 + (pixel[1] ?? 0) * 0.7152 + (pixel[2] ?? 0) * 0.0722;
  const inverted = mask.invert ? 1 - value : value;
  return Math.max(0, Math.min(1, inverted * mask.density));
}

function mixEffectMask(
  original: Surface,
  adjusted: Surface,
  mask: NonNullable<Entity['mask']>,
  ownerId: string,
  output: Region,
  scale: number,
): Surface {
  const maskSurface = evaluateMask(ownerId, mask, output, scale);
  const maskPixel = new Float32Array(4);
  for (let y = 0; y < output.h; y += 1) {
    for (let x = 0; x < output.w; x += 1) {
      const amount = maskAmount(mask, maskSurface, output.x + x, output.y + y, maskPixel);
      const offset = (y * output.w + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        adjusted.data[offset + channel] =
          (original.data[offset + channel] ?? 0) * (1 - amount) +
          (adjusted.data[offset + channel] ?? 0) * amount;
      }
    }
  }
  return adjusted;
}

function multiplySurface(surface: Surface, amount: number): void {
  for (let offset = 0; offset < surface.data.length; offset += 1) {
    surface.data[offset] = (surface.data[offset] ?? 0) * amount;
  }
}

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
    const original = effect.mask === undefined ? null : cropSurface(surface, effectOutput);
    surface = applyEffect(effect, surface, effectOutput, scale);
    if (effect.mask !== undefined && original !== null) {
      surface = mixEffectMask(
        original,
        surface,
        effect.mask,
        `${entity.id}:effect:${index}`,
        effectOutput,
        scale,
      );
    }
  }
  if (entity.mask !== undefined) {
    const maskSurface = evaluateMask(entity.id, entity.mask, output, scale);
    const maskPixel = new Float32Array(4);
    for (let y = 0; y < output.h; y += 1) {
      for (let x = 0; x < output.w; x += 1) {
        const amount = maskAmount(entity.mask, maskSurface, output.x + x, output.y + y, maskPixel);
        const offset = (y * output.w + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          surface.data[offset + channel] = (surface.data[offset + channel] ?? 0) * amount;
        }
      }
    }
  }
  multiplySurface(surface, Math.max(0, entity.opacity));
  return surface;
}

type GraphStackItem = { entity: Entity; kind: 'entity' } | { filter: GraphFilter; kind: 'filter' };

function graphStack(graph: Graph): GraphStackItem[] {
  const filters = graph.filters ?? [];
  const items: GraphStackItem[] = [];
  let filterIndex = 0;
  for (let position = 0; position <= graph.entities.length; position += 1) {
    while (filters[filterIndex]?.position === position) {
      const filter = filters[filterIndex];
      if (filter !== undefined) items.push({ filter, kind: 'filter' });
      filterIndex += 1;
    }
    const entity = graph.entities[position];
    if (entity !== undefined) items.push({ entity, kind: 'entity' });
  }
  if (filterIndex !== filters.length) throw new Error('Filter stack positions are out of order');
  return items;
}

function renderStack(items: readonly GraphStackItem[], output: Region, scale: number): Surface {
  const lastFilterIndex = items.findLastIndex(item => item.kind === 'filter');
  if (lastFilterIndex < 0) {
    const accumulator = makeSurface(output);
    for (const item of items) {
      if (item.kind === 'entity') {
        blendOnto(accumulator, evalEntity(item.entity, output, scale), item.entity.blend);
      }
    }
    return accumulator;
  }
  const item = items[lastFilterIndex];
  if (item?.kind !== 'filter') throw new Error('Invalid filter stack');
  const inputRegion = effectInputRegion(item.filter.effect, output, scale);
  const input = renderStack(items.slice(0, lastFilterIndex), inputRegion, scale);
  const original = item.filter.effect.mask === undefined ? null : cropSurface(input, output);
  let accumulator = applyEffect(item.filter.effect, input, output, scale);
  if (item.filter.effect.mask !== undefined && original !== null) {
    accumulator = mixEffectMask(
      original,
      accumulator,
      item.filter.effect.mask,
      item.filter.id,
      output,
      scale,
    );
  }
  for (const upper of items.slice(lastFilterIndex + 1)) {
    if (upper.kind === 'entity') {
      blendOnto(accumulator, evalEntity(upper.entity, output, scale), upper.entity.blend);
    }
  }
  return accumulator;
}

export function renderRegion(graph: Graph, output: Region, scale: number): Surface {
  return renderStack(graphStack(graph), output, scale);
}
