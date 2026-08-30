import { applyEffect, effectInputRegion } from './effects.js';
import type { DropShadowLayerEffect, Entity, Graph, GraphFilter } from './graph.js';
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

function unionRegion(left: Region, right: Region): Region {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.w, right.x + right.w);
  const bottomEdge = Math.max(left.y + left.h, right.y + right.h);
  return { h: bottomEdge - y, w: rightEdge - x, x, y };
}

function layerEffectInputRegion(entity: Entity, output: Region, scale: number): Region {
  let input = output;
  for (const effect of entity.layerEffects ?? []) {
    if (effect.kind !== 'drop-shadow') continue;
    const shifted = expandRegion(output, effect.radius * scale * 3);
    shifted.x -= Math.round(effect.offsetX * scale);
    shifted.y -= Math.round(effect.offsetY * scale);
    input = unionRegion(input, shifted);
  }
  return input;
}

function renderDropShadow(
  owner: Surface,
  effect: DropShadowLayerEffect,
  output: Region,
  scale: number,
): Surface {
  const blurInputRegion = expandRegion(output, effect.radius * scale * 3);
  const blurInput = makeSurface(blurInputRegion);
  const pixel = new Float32Array(4);
  const offsetX = Math.round(effect.offsetX * scale);
  const offsetY = Math.round(effect.offsetY * scale);
  for (let y = 0; y < blurInputRegion.h; y += 1) {
    for (let x = 0; x < blurInputRegion.w; x += 1) {
      readPremul(owner, blurInputRegion.x + x - offsetX, blurInputRegion.y + y - offsetY, pixel);
      const alpha = pixel[3] ?? 0;
      const target = (y * blurInputRegion.w + x) * 4;
      blurInput.data[target] = alpha;
      blurInput.data[target + 1] = alpha;
      blurInput.data[target + 2] = alpha;
      blurInput.data[target + 3] = alpha;
    }
  }
  const shadow = applyEffect({ kind: 'blur', sigma: effect.radius }, blurInput, output, scale);
  for (let offset = 0; offset < shadow.data.length; offset += 4) {
    const alpha = (shadow.data[offset + 3] ?? 0) * Math.max(0, effect.opacity);
    shadow.data[offset] = (effect.color[0] ?? 0) * alpha;
    shadow.data[offset + 1] = (effect.color[1] ?? 0) * alpha;
    shadow.data[offset + 2] = (effect.color[2] ?? 0) * alpha;
    shadow.data[offset + 3] = alpha;
  }
  return shadow;
}

function applyAttachedShadows(
  entity: Entity,
  owner: Surface,
  output: Region,
  scale: number,
): Surface {
  const result = makeSurface(output);
  for (const effect of entity.layerEffects ?? []) {
    if (effect.kind === 'drop-shadow') {
      blendOnto(result, renderDropShadow(owner, effect, output, scale), 'normal');
    }
  }
  blendOnto(result, cropSurface(owner, output), 'normal');
  return result;
}

export function evalEntity(entity: Entity, output: Region, scale: number): Surface {
  const regions = new Array<Region>(entity.effects.length + 1);
  const ownerOutput = layerEffectInputRegion(entity, output, scale);
  regions[entity.effects.length] = ownerOutput;
  for (let index = entity.effects.length - 1; index >= 0; index -= 1) {
    const effect = entity.effects[index];
    const effectOutput = regions[index + 1];
    if (effect === undefined || effectOutput === undefined) throw new Error('Invalid effect chain');
    regions[index] = effectInputRegion(effect, effectOutput, scale);
  }
  const sourceRegion = regions[0];
  if (sourceRegion === undefined) throw new Error('Missing source region');
  let surface =
    entity.source.kind === 'graph'
      ? renderRegion(entity.source.graph, sourceRegion, scale)
      : rasterSource(entity, sourceRegion, scale);
  if (entity.source.kind === 'graph') multiplySurface(surface, Math.max(0, entity.fill ?? 1));
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
    const maskSurface = evaluateMask(entity.id, entity.mask, ownerOutput, scale);
    const maskPixel = new Float32Array(4);
    for (let y = 0; y < ownerOutput.h; y += 1) {
      for (let x = 0; x < ownerOutput.w; x += 1) {
        const amount = maskAmount(
          entity.mask,
          maskSurface,
          ownerOutput.x + x,
          ownerOutput.y + y,
          maskPixel,
        );
        const offset = (y * ownerOutput.w + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          surface.data[offset + channel] = (surface.data[offset + channel] ?? 0) * amount;
        }
      }
    }
  }
  surface = applyAttachedShadows(entity, surface, output, scale);
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

function copySurface(surface: Surface, region: Region): Surface {
  return cropSurface(surface, region);
}

function mixPassThroughGroup(
  before: Surface,
  after: Surface,
  entity: Entity,
  output: Region,
  scale: number,
): Surface {
  const result = makeSurface(output);
  const maskSurface =
    entity.mask === undefined ? null : evaluateMask(entity.id, entity.mask, output, scale);
  const maskPixel = new Float32Array(4);
  for (let y = 0; y < output.h; y += 1) {
    for (let x = 0; x < output.w; x += 1) {
      const offset = (y * output.w + x) * 4;
      const mask =
        entity.mask === undefined || maskSurface === null
          ? 1
          : maskAmount(entity.mask, maskSurface, output.x + x, output.y + y, maskPixel);
      const amount = Math.max(0, Math.min(1, entity.opacity * mask));
      for (let channel = 0; channel < 4; channel += 1) {
        result.data[offset + channel] =
          (before.data[offset + channel] ?? 0) * (1 - amount) +
          (after.data[offset + channel] ?? 0) * amount;
      }
    }
  }
  return result;
}

function blendStackEntity(
  accumulator: Surface,
  entity: Entity,
  output: Region,
  scale: number,
): Surface {
  if (
    entity.source.kind !== 'graph' ||
    !entity.source.passThrough ||
    (entity.layerEffects?.length ?? 0) > 0
  ) {
    blendOnto(accumulator, evalEntity(entity, output, scale), entity.blend);
    return accumulator;
  }
  const before = copySurface(accumulator, output);
  const after = renderStack(graphStack(entity.source.graph), output, scale, before);
  return mixPassThroughGroup(before, after, entity, output, scale);
}

function mixBackgroundBlur(
  original: Surface,
  blurred: Surface,
  coverage: Surface,
  opacity: number,
): Surface {
  const output = makeSurface(original.region);
  for (let offset = 0; offset < output.data.length; offset += 4) {
    const amount = Math.max(0, Math.min(1, (coverage.data[offset + 3] ?? 0) * opacity));
    for (let channel = 0; channel < 4; channel += 1) {
      output.data[offset + channel] =
        (original.data[offset + channel] ?? 0) * (1 - amount) +
        (blurred.data[offset + channel] ?? 0) * amount;
    }
  }
  return output;
}

function renderStack(
  items: readonly GraphStackItem[],
  output: Region,
  scale: number,
  initial?: Surface,
): Surface {
  const lastFilterIndex = items.findLastIndex(item => item.kind === 'filter');
  const lastBackgroundBlurIndex = items.findLastIndex(
    item =>
      item.kind === 'entity' &&
      item.entity.layerEffects?.some(effect => effect.kind === 'background-blur'),
  );
  const lastModifierIndex = Math.max(lastFilterIndex, lastBackgroundBlurIndex);
  if (lastModifierIndex < 0) {
    let accumulator = initial === undefined ? makeSurface(output) : copySurface(initial, output);
    for (const item of items) {
      if (item.kind === 'entity') {
        accumulator = blendStackEntity(accumulator, item.entity, output, scale);
      }
    }
    return accumulator;
  }
  const item = items[lastModifierIndex];
  if (item?.kind === 'entity') {
    const backgroundBlurs = (item.entity.layerEffects ?? []).filter(
      effect => effect.kind === 'background-blur',
    );
    const radius = Math.max(0, ...backgroundBlurs.map(effect => effect.radius));
    const inputRegion = expandRegion(output, radius * scale * 3);
    const input = renderStack(items.slice(0, lastModifierIndex), inputRegion, scale, initial);
    const original = cropSurface(input, output);
    const coverage = evalEntity({ ...item.entity, layerEffects: [] }, output, scale);
    let accumulator = original;
    for (const effect of backgroundBlurs) {
      const blurred = applyEffect({ kind: 'blur', sigma: effect.radius }, input, output, scale);
      accumulator = mixBackgroundBlur(accumulator, blurred, coverage, effect.opacity);
    }
    blendOnto(accumulator, evalEntity(item.entity, output, scale), item.entity.blend);
    for (const upper of items.slice(lastModifierIndex + 1)) {
      if (upper.kind === 'entity') {
        accumulator = blendStackEntity(accumulator, upper.entity, output, scale);
      }
    }
    return accumulator;
  }
  if (item?.kind !== 'filter') throw new Error('Invalid filter stack');
  const inputRegion = effectInputRegion(item.filter.effect, output, scale);
  const input = renderStack(items.slice(0, lastModifierIndex), inputRegion, scale, initial);
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
  for (const upper of items.slice(lastModifierIndex + 1)) {
    if (upper.kind === 'entity') {
      accumulator = blendStackEntity(accumulator, upper.entity, output, scale);
    }
  }
  return accumulator;
}

export function renderRegion(graph: Graph, output: Region, scale: number): Surface {
  return renderStack(graphStack(graph), output, scale);
}
