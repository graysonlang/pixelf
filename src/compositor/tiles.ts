import { graphHash, type Graph } from './graph.js';
import { evalEntity, renderRegion } from './render.js';
import {
  blendOnto,
  cropSurface,
  makeSurface,
  readPremul,
  type Region,
  type Surface,
} from './surface.js';

export const TILE_SIZE = 256;
export type RenderQuality = 'draft' | 'final' | 'preview';

export interface TileRequest {
  graph: Graph;
  quality: RenderQuality;
  region: Region;
  scale: number;
  targetKey: string;
}

export interface RenderedTile {
  key: string;
  surface: Surface;
  tileX: number;
  tileY: number;
}

export interface TileCacheStats {
  entries: number;
  hits: number;
  misses: number;
}

export interface TileCacheUsage extends TileCacheStats {
  budgetBytes: number;
  bytes: number;
  evictions: number;
}

export class TileCache {
  private readonly entries = new Map<string, { bytes: number; surface: Surface }>();
  private byteCount = 0;
  private evictionCount = 0;
  private hitCount = 0;
  private missCount = 0;

  constructor(readonly budgetBytes = 256 * 1024 * 1024) {
    if (!Number.isFinite(budgetBytes) || budgetBytes < 0) {
      throw new Error('Tile cache budget must be a non-negative number');
    }
  }

  get(key: string): Surface | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      this.missCount += 1;
      return undefined;
    }
    this.hitCount += 1;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.surface;
  }

  set(key: string, surface: Surface): void {
    const existing = this.entries.get(key);
    if (existing !== undefined) this.byteCount -= existing.bytes;
    this.entries.delete(key);
    const bytes = surface.data.byteLength;
    this.entries.set(key, { bytes, surface });
    this.byteCount += bytes;
    while (this.byteCount > this.budgetBytes && this.entries.size > 1) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const removed = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.byteCount -= removed?.bytes ?? 0;
      this.evictionCount += 1;
    }
  }

  clear(): void {
    this.entries.clear();
    this.byteCount = 0;
    this.evictionCount = 0;
    this.hitCount = 0;
    this.missCount = 0;
  }

  releaseGraph(graph: Graph): number {
    const hashes = new Set([
      graphHash(graph),
      ...graph.entities.map(entity => graphHash({ entities: [entity] })),
    ]);
    let released = 0;
    for (const [key, entry] of this.entries) {
      if (![...hashes].some(hash => key.startsWith(`${hash}:`))) continue;
      this.entries.delete(key);
      this.byteCount -= entry.bytes;
      released += 1;
    }
    return released;
  }

  stats(): TileCacheStats {
    return { entries: this.entries.size, hits: this.hitCount, misses: this.missCount };
  }

  usage(): TileCacheUsage {
    return {
      ...this.stats(),
      budgetBytes: this.budgetBytes,
      bytes: this.byteCount,
      evictions: this.evictionCount,
    };
  }
}

function tileKey(
  graph: Graph,
  targetKey: string,
  quality: RenderQuality,
  scale: number,
  tileX: number,
  tileY: number,
): string {
  return [graphHash(graph), targetKey, quality, scale.toPrecision(12), tileX, tileY].join(':');
}

export function renderTiles(request: TileRequest, cache = new TileCache()): RenderedTile[] {
  if (request.region.w <= 0 || request.region.h <= 0) return [];
  const firstTileX = Math.floor(request.region.x / TILE_SIZE);
  const firstTileY = Math.floor(request.region.y / TILE_SIZE);
  const lastTileX = Math.floor((request.region.x + request.region.w - 1) / TILE_SIZE);
  const lastTileY = Math.floor((request.region.y + request.region.h - 1) / TILE_SIZE);
  const output: RenderedTile[] = [];
  for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      const key = tileKey(
        request.graph,
        request.targetKey,
        request.quality,
        request.scale,
        tileX,
        tileY,
      );
      const tileRegion = {
        h: TILE_SIZE,
        w: TILE_SIZE,
        x: tileX * TILE_SIZE,
        y: tileY * TILE_SIZE,
      };
      if ((request.graph.filters?.length ?? 0) > 0) {
        let filteredSurface = cache.get(key);
        if (filteredSurface === undefined) {
          filteredSurface = renderRegion(request.graph, tileRegion, request.scale);
          cache.set(key, filteredSurface);
        }
        output.push({ key, surface: filteredSurface, tileX, tileY });
        continue;
      }
      const surface = makeSurface(tileRegion);
      for (const entity of request.graph.entities) {
        const entityKey = tileKey(
          { entities: [entity] },
          request.targetKey,
          request.quality,
          request.scale,
          tileX,
          tileY,
        );
        let entitySurface = cache.get(entityKey);
        if (entitySurface === undefined) {
          entitySurface = evalEntity(entity, tileRegion, request.scale);
          cache.set(entityKey, entitySurface);
        }
        blendOnto(surface, entitySurface, entity.blend);
      }
      output.push({ key, surface, tileX, tileY });
    }
  }
  return output;
}

export function assembleTiles(tiles: readonly RenderedTile[], region: Region): Surface {
  const output = makeSurface(region);
  const pixel = new Float32Array(4);
  for (const tile of tiles) {
    const overlap = cropSurface(tile.surface, {
      h: Math.max(
        0,
        Math.min(region.y + region.h, tile.surface.region.y + tile.surface.region.h) -
          Math.max(region.y, tile.surface.region.y),
      ),
      w: Math.max(
        0,
        Math.min(region.x + region.w, tile.surface.region.x + tile.surface.region.w) -
          Math.max(region.x, tile.surface.region.x),
      ),
      x: Math.max(region.x, tile.surface.region.x),
      y: Math.max(region.y, tile.surface.region.y),
    });
    for (let y = 0; y < overlap.region.h; y += 1) {
      for (let x = 0; x < overlap.region.w; x += 1) {
        const worldX = overlap.region.x + x;
        const worldY = overlap.region.y + y;
        readPremul(overlap, worldX, worldY, pixel);
        const outputOffset = ((worldY - region.y) * region.w + worldX - region.x) * 4;
        output.data.set(pixel, outputOffset);
      }
    }
  }
  return output;
}
