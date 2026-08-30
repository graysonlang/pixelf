import { effectInputRegion } from './effects.js';
import type { Entity, Graph } from './graph.js';
import { graphHash } from './graph.js';
import { evalEntity, renderRegion } from './render.js';
import { blendOnto, intersectRegion, makeSurface, type Region, type Surface } from './surface.js';
import { TILE_SIZE, TileCache, type RenderQuality } from './tiles.js';

export interface ViewportTileRequest {
  generation: number;
  graph: Graph;
  maxTextureSize: number;
  prefetchTiles?: number;
  quality: RenderQuality;
  scale: number;
  target: Region;
  targetKey: string;
  viewport: Region;
}

export interface EntityInputRequirement {
  entityId: string;
  region: Region;
}

export interface PlannedTile {
  inputRequirements: readonly EntityInputRequirement[];
  key: string;
  kind: 'foreground' | 'prefetch';
  output: Region;
  priority: number;
}

export interface TileWorkPlan {
  generation: number;
  graph: Graph;
  quality: RenderQuality;
  scale: number;
  targetKey: string;
  tiles: readonly PlannedTile[];
  viewport: Region;
}

export interface PlannedTileResult {
  key: string;
  output: Region;
  surface: Surface;
}

function requiredEntityRegion(
  entity: Entity,
  entityIndex: number,
  graph: Graph,
  output: Region,
  scale: number,
): Region {
  let region = output;
  for (let index = (graph.filters?.length ?? 0) - 1; index >= 0; index -= 1) {
    const filter = graph.filters?.[index];
    if (filter !== undefined && filter.position > entityIndex) {
      region = effectInputRegion(filter.effect, region, scale);
    }
  }
  for (let index = entity.effects.length - 1; index >= 0; index -= 1) {
    const effect = entity.effects[index];
    if (effect !== undefined) region = effectInputRegion(effect, region, scale);
  }
  return region;
}

export function buildTileWorkPlan(request: ViewportTileRequest): TileWorkPlan {
  if (!(request.scale > 0)) throw new Error('Work-plan scale must be positive');
  if (!Number.isInteger(request.maxTextureSize) || request.maxTextureSize <= 0) {
    throw new Error('Maximum texture size must be a positive integer');
  }
  const tileSize = Math.min(TILE_SIZE, request.maxTextureSize);
  const margin = Math.max(0, request.prefetchTiles ?? 1) * tileSize;
  const requested = intersectRegion(request.target, {
    h: request.viewport.h + margin * 2,
    w: request.viewport.w + margin * 2,
    x: request.viewport.x - margin,
    y: request.viewport.y - margin,
  });
  if (requested === null) {
    return { ...request, tiles: [] };
  }
  const firstX = Math.floor(requested.x / tileSize) * tileSize;
  const firstY = Math.floor(requested.y / tileSize) * tileSize;
  const viewportCenterX = request.viewport.x + request.viewport.w / 2;
  const viewportCenterY = request.viewport.y + request.viewport.h / 2;
  const tiles: PlannedTile[] = [];
  for (let y = firstY; y < requested.y + requested.h; y += tileSize) {
    for (let x = firstX; x < requested.x + requested.w; x += tileSize) {
      const output = intersectRegion(request.target, { h: tileSize, w: tileSize, x, y });
      if (output === null) continue;
      const kind = intersectRegion(request.viewport, output) === null ? 'prefetch' : 'foreground';
      const centerX = output.x + output.w / 2;
      const centerY = output.y + output.h / 2;
      const distance = Math.hypot(centerX - viewportCenterX, centerY - viewportCenterY);
      tiles.push({
        inputRequirements: request.graph.entities.map((entity, entityIndex) => ({
          entityId: entity.id,
          region: requiredEntityRegion(entity, entityIndex, request.graph, output, request.scale),
        })),
        key: [
          graphHash(request.graph),
          request.targetKey,
          request.quality,
          request.scale.toPrecision(12),
          output.x,
          output.y,
          output.w,
          output.h,
        ].join(':'),
        kind,
        output,
        priority: (kind === 'foreground' ? 0 : 1_000_000) + distance,
      });
    }
  }
  tiles.sort((left, right) => left.priority - right.priority);
  return {
    generation: request.generation,
    graph: request.graph,
    quality: request.quality,
    scale: request.scale,
    targetKey: request.targetKey,
    tiles,
    viewport: { ...request.viewport },
  };
}

export function executeTileWorkPlan(
  plan: TileWorkPlan,
  cache = new TileCache(),
  isCurrent: (generation: number) => boolean = () => true,
): PlannedTileResult[] {
  const results: PlannedTileResult[] = [];
  for (const tile of plan.tiles) {
    if (!isCurrent(plan.generation)) break;
    if ((plan.graph.filters?.length ?? 0) > 0) {
      const graphKey = [
        graphHash(plan.graph),
        plan.targetKey,
        plan.quality,
        plan.scale.toPrecision(12),
        tile.output.x,
        tile.output.y,
        tile.output.w,
        tile.output.h,
      ].join(':');
      let filteredSurface = cache.get(graphKey);
      if (filteredSurface === undefined) {
        filteredSurface = renderRegion(plan.graph, tile.output, plan.scale);
        cache.set(graphKey, filteredSurface);
      }
      if (isCurrent(plan.generation)) {
        results.push({ key: tile.key, output: tile.output, surface: filteredSurface });
      }
      continue;
    }
    const surface = makeSurface(tile.output);
    for (const entity of plan.graph.entities) {
      const entityKey = [
        graphHash({ entities: [entity] }),
        plan.targetKey,
        plan.quality,
        plan.scale.toPrecision(12),
        tile.output.x,
        tile.output.y,
        tile.output.w,
        tile.output.h,
      ].join(':');
      let projected = cache.get(entityKey);
      if (projected === undefined) {
        projected = evalEntity(entity, tile.output, plan.scale);
        cache.set(entityKey, projected);
      }
      blendOnto(surface, projected, entity.blend);
    }
    if (isCurrent(plan.generation)) results.push({ key: tile.key, output: tile.output, surface });
  }
  return results;
}
