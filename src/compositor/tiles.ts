import { graphHash, type Graph } from './graph.js';
import { renderRegion } from './render.js';
import { cropSurface, makeSurface, readPremul, type Region, type Surface } from './surface.js';

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

export class TileCache {
  private readonly entries = new Map<string, Surface>();
  private hitCount = 0;
  private missCount = 0;

  get(key: string): Surface | undefined {
    const surface = this.entries.get(key);
    if (surface === undefined) this.missCount += 1;
    else this.hitCount += 1;
    return surface;
  }

  set(key: string, surface: Surface): void {
    this.entries.set(key, surface);
  }

  clear(): void {
    this.entries.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  stats(): TileCacheStats {
    return { entries: this.entries.size, hits: this.hitCount, misses: this.missCount };
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
      let surface = cache.get(key);
      if (surface === undefined) {
        surface = renderRegion(
          request.graph,
          {
            h: TILE_SIZE,
            w: TILE_SIZE,
            x: tileX * TILE_SIZE,
            y: tileY * TILE_SIZE,
          },
          request.scale,
        );
        cache.set(key, surface);
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
