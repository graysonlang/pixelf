import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildTileWorkPlan,
  executeTileWorkPlan,
  image,
  makeSurface,
  readPremul,
  renderRegion,
  renderTiles,
  solid,
  TileCache,
  type Graph,
  type Region,
} from '../src/compositor/index.js';
import { RenderMetrics, RuntimeBudgets, WorkScheduler } from '../src/runtime/index.js';

function copyResults(
  results: ReturnType<typeof executeTileWorkPlan>,
  region: Region,
): Float32Array {
  const output = makeSurface(region);
  const pixel = new Float32Array(4);
  for (const result of results) {
    for (let y = 0; y < result.output.h; y += 1) {
      for (let x = 0; x < result.output.w; x += 1) {
        const worldX = result.output.x + x;
        const worldY = result.output.y + y;
        readPremul(result.surface, worldX, worldY, pixel);
        output.data.set(pixel, ((worldY - region.y) * region.w + worldX - region.x) * 4);
      }
    }
  }
  return output.data;
}

describe('demand-driven tiles and large-image runtime', () => {
  it('plans only the visible viewport and prefetch margin within texture limits', () => {
    const graph: Graph = {
      entities: [
        {
          blend: 'normal',
          effects: [{ kind: 'blur', sigma: 4 }],
          h: 8000,
          id: 'large-image',
          opacity: 1,
          source: solid(1, 0, 0),
          w: 10000,
          x: 0,
          y: 0,
        },
      ],
    };
    const plan = buildTileWorkPlan({
      generation: 7,
      graph,
      maxTextureSize: 128,
      prefetchTiles: 1,
      quality: 'preview',
      scale: 1,
      target: { h: 8000, w: 10000, x: 0, y: 0 },
      targetKey: 'rgba16float:display-p3',
      viewport: { h: 300, w: 400, x: 4000, y: 3000 },
    });
    assert.ok(plan.tiles.length > 0 && plan.tiles.length < 100);
    assert.ok(plan.tiles.some(tile => tile.kind === 'foreground'));
    assert.ok(plan.tiles.some(tile => tile.kind === 'prefetch'));
    assert.ok(plan.tiles.every(tile => tile.output.w <= 128 && tile.output.h <= 128));
    const blurred = plan.tiles[0];
    const input = blurred?.inputRequirements[0]?.region;
    assert.ok(blurred && input);
    assert.ok(input.w > blurred.output.w && input.h > blurred.output.h);
    assert.match(blurred.key, /rgba16float:display-p3:preview/);
  });

  it('renders split halo tiles without seams and stops publishing stale generations', () => {
    const graph: Graph = {
      entities: [
        {
          blend: 'normal',
          effects: [{ kind: 'blur', sigma: 2 }],
          h: 260,
          id: 'seam-source',
          opacity: 1,
          source: solid(0.8, 0.2, 0.1),
          w: 260,
          x: 20,
          y: 20,
        },
      ],
    };
    const region = { h: 300, w: 300, x: 0, y: 0 };
    const plan = buildTileWorkPlan({
      generation: 2,
      graph,
      maxTextureSize: 96,
      prefetchTiles: 0,
      quality: 'final',
      scale: 1,
      target: region,
      targetKey: 'target-seams',
      viewport: region,
    });
    const results = executeTileWorkPlan(plan);
    assert.deepEqual([...copyResults(results, region)], [...renderRegion(graph, region, 1).data]);
    assert.deepEqual(
      executeTileWorkPlan(plan, new TileCache(), () => false),
      [],
    );
  });

  it('reuses unaffected entity tiles after a localized edit', () => {
    const background = {
      blend: 'normal' as const,
      effects: [],
      h: 256,
      id: 'background',
      opacity: 1,
      source: solid(0.2, 0.2, 0.2),
      w: 256,
      x: 0,
      y: 0,
    };
    const foreground = {
      ...background,
      id: 'foreground',
      source: solid(1, 0, 0),
    };
    const cache = new TileCache();
    const request = {
      graph: { entities: [background, foreground] },
      quality: 'preview' as const,
      region: { h: 256, w: 256, x: 0, y: 0 },
      scale: 1,
      targetKey: 'target:rgba16float:srgb',
    };
    renderTiles(request, cache);
    renderTiles(
      {
        ...request,
        graph: { entities: [background, { ...foreground, opacity: 0.5 }] },
      },
      cache,
    );
    assert.deepEqual(cache.stats(), { entries: 3, hits: 1, misses: 3 });
  });

  it('keeps separate observable budgets and evicts least-recently-used entries', () => {
    const budgets = new RuntimeBudgets({
      cpuWorking: 10,
      decodedSources: 20,
      derivedTiles: 30,
      gpuTextures: 40,
    });
    budgets.cpuWorking.reserve('first', 6);
    budgets.cpuWorking.reserve('second', 6);
    budgets.decodedSources.reserve('decoded', 12);
    budgets.derivedTiles.reserve('tile', 20);
    budgets.gpuTextures.reserve('texture', 30);
    const snapshot = budgets.snapshot();
    assert.deepEqual(snapshot.cpuWorking, {
      budgetBytes: 10,
      bytes: 6,
      entries: 1,
      evictions: 1,
    });
    assert.equal(snapshot.decodedSources.bytes, 12);
    assert.equal(snapshot.derivedTiles.bytes, 20);
    assert.equal(snapshot.gpuTextures.bytes, 30);

    const cache = new TileCache(1_100_000);
    const source = image(1, 1, new Float32Array([1, 0, 0, 1]), 'budget-source');
    renderTiles(
      {
        graph: {
          entities: [
            {
              blend: 'normal',
              effects: [],
              h: 256,
              id: 'one',
              opacity: 1,
              source,
              w: 256,
              x: 0,
              y: 0,
            },
            {
              blend: 'normal',
              effects: [],
              h: 256,
              id: 'two',
              opacity: 1,
              source,
              w: 256,
              x: 0,
              y: 0,
            },
          ],
        },
        quality: 'preview',
        region: { h: 256, w: 256, x: 0, y: 0 },
        scale: 1,
        targetKey: 'budget',
      },
      cache,
    );
    assert.ok(cache.usage().bytes <= cache.usage().budgetBytes);
    assert.equal(cache.usage().evictions, 1);
  });

  it('prioritizes work classes and prevents old work from replacing a new generation', async () => {
    const scheduler = new WorkScheduler(1);
    const firstGeneration = scheduler.beginGeneration();
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const blocker = scheduler.schedule('foreground', firstGeneration, async signal => {
      await gate;
      return signal.aborted ? 'aborted' : 'old';
    });
    const queued = scheduler.schedule('thumbnail', firstGeneration, () => 'thumbnail');
    const secondGeneration = scheduler.beginGeneration();
    const order: string[] = [];
    const exportWork = scheduler.schedule('export', secondGeneration, () => {
      order.push('export');
      return 'export';
    });
    const thumbnail = scheduler.schedule('thumbnail', secondGeneration, () => {
      order.push('thumbnail');
      return 'thumbnail';
    });
    const refinement = scheduler.schedule('refinement', secondGeneration, () => {
      order.push('refinement');
      return 'refinement';
    });
    const foreground = scheduler.schedule('foreground', secondGeneration, () => {
      order.push('foreground');
      return 'foreground';
    });
    release();
    assert.ok(['canceled', 'stale'].includes((await blocker).status));
    assert.equal((await queued).status, 'stale');
    await Promise.all([exportWork, thumbnail, refinement, foreground]);
    assert.deepEqual(order, ['foreground', 'refinement', 'thumbnail', 'export']);
  });

  it('records decode, evaluation, upload, GPU, readback, encoding, and cache metrics', async () => {
    let time = 0;
    const metrics = new RenderMetrics(() => {
      time += 2;
      return time;
    });
    metrics.measure('decode', () => 1);
    await metrics.measureAsync('evaluate', async () => 2);
    for (const stage of ['upload', 'commandEncoding', 'gpuExecution', 'readback'] as const) {
      metrics.measure(stage, () => undefined);
    }
    metrics.recordCache(true);
    metrics.recordCache(false, 2);
    const snapshot = metrics.snapshot();
    assert.equal(snapshot.stages.decode.calls, 1);
    assert.equal(snapshot.stages.evaluate.milliseconds, 2);
    assert.equal(snapshot.stages.upload.calls, 1);
    assert.equal(snapshot.stages.commandEncoding.calls, 1);
    assert.equal(snapshot.stages.gpuExecution.calls, 1);
    assert.equal(snapshot.stages.readback.calls, 1);
    assert.deepEqual(
      [snapshot.cacheHits, snapshot.cacheMisses, snapshot.cacheEvictions],
      [1, 1, 2],
    );
  });
});
