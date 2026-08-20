import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BLEND_MODES,
  assembleTiles,
  blur,
  effectInputRegion,
  graphHash,
  image,
  projectTargetToGraph,
  renderRegion,
  renderTiles,
  solid,
  TileCache,
  type Entity,
  type Graph,
  type Region,
} from '../src/compositor/index.js';
import {
  cloneProject,
  createEmbeddedImageAsset,
  createImportedProject,
  createNode,
  type ProcessorNode,
} from '../src/project/index.js';

function entity(source: Entity['source'], overrides: Partial<Entity> = {}): Entity {
  return {
    blend: 'normal',
    effects: [],
    h: 32,
    id: 'entity-one',
    opacity: 1,
    source,
    w: 32,
    x: 0,
    y: 0,
    ...overrides,
  };
}

function assertPixelsEqual(actual: Float32Array, expected: Float32Array): void {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    assert.equal(actual[index], expected[index], `pixel channel ${index}`);
  }
}

describe('CPU reference compositor', () => {
  it('renders the same graph, region, and scale deterministically', () => {
    const graph = { entities: [entity(solid(0.2, 0.4, 0.8, 0.75))] };
    const region = { h: 20, w: 24, x: -2, y: 3 };
    const first = renderRegion(graph, region, 1);
    const second = renderRegion(graph, region, 1);
    assert.equal(graphHash(graph), graphHash(structuredClone(graph)));
    assertPixelsEqual(first.data, second.data);
  });

  it('propagates blur halos and makes isolated tiles bit-identical to a full render', () => {
    const effect = blur(3);
    assert.deepEqual(effectInputRegion(effect, { h: 10, w: 20, x: 5, y: 7 }, 2), {
      h: 46,
      w: 56,
      x: -13,
      y: -11,
    });
    const graph: Graph = {
      entities: [
        entity(solid(0.8, 0.2, 0.1), {
          effects: [effect],
          h: 100,
          w: 170,
          x: 90,
          y: 80,
        }),
      ],
    };
    const region: Region = { h: 270, w: 300, x: 0, y: 0 };
    const full = renderRegion(graph, region, 1);
    const tiled = assembleTiles(
      renderTiles({ graph, quality: 'final', region, scale: 1, targetKey: 'rgba16float' }),
      region,
    );
    assertPixelsEqual(tiled.data, full.data);
  });

  it('minifies transparent edges in premultiplied linear space without color bleed', () => {
    const pixels = new Float32Array([1, 0, 0, 1, 0, 0, 1, 0]);
    const graph = {
      entities: [entity(image(2, 1, pixels, 'source-a'), { h: 1, w: 1 })],
    };
    const output = renderRegion(graph, { h: 1, w: 1, x: 0, y: 0 }, 1);
    assert.deepEqual([...output.data], [0.5, 0, 0, 0.5]);
  });

  it('applies affine placement and separable blend modes in linear light', () => {
    const placed = renderRegion(
      {
        entities: [
          entity(solid(1, 0, 0), {
            h: 2,
            matrix: [1, 0, 0, 1, 2, 1],
            w: 2,
          }),
        ],
      },
      { h: 4, w: 5, x: 0, y: 0 },
      1,
    );
    assert.deepEqual([...placed.data.slice((1 * 5 + 2) * 4, (1 * 5 + 2) * 4 + 4)], [1, 0, 0, 1]);
    assert.deepEqual([...placed.data.slice(0, 4)], [0, 0, 0, 0]);

    const blended = renderRegion(
      {
        entities: [
          entity(solid(0.25, 0.25, 0.25), { h: 1, id: 'backdrop', w: 1 }),
          entity(solid(0.75, 0.75, 0.75), {
            blend: 'screen',
            h: 1,
            id: 'source',
            w: 1,
          }),
        ],
      },
      { h: 1, w: 1, x: 0, y: 0 },
      1,
    );
    assert.deepEqual([...blended.data], [0.8125, 0.8125, 0.8125, 1]);
  });

  it('evaluates every Photoshop-style blend mode deterministically', () => {
    for (const blend of BLEND_MODES) {
      const graph: Graph = {
        entities: [
          entity(solid(0.2, 0.5, 0.8), { h: 4, id: 'backdrop', w: 4 }),
          entity(solid(0.8, 0.3, 0.1, 0.6), { blend, h: 4, id: 'source', w: 4 }),
        ],
      };
      const first = renderRegion(graph, { h: 4, w: 4, x: 0, y: 0 }, 1);
      const second = renderRegion(graph, { h: 4, w: 4, x: 0, y: 0 }, 1);
      assert.ok([...first.data].every(Number.isFinite), blend);
      assert.deepEqual([...first.data], [...second.data], blend);
    }
  });

  it('applies fill before effects and opacity after effects', () => {
    const secondary = image(1, 1, new Float32Array([0, 0, 1, 1]), 'secondary');
    const common: Partial<Entity> = {
      effects: [
        {
          blend: 'normal',
          height: 1,
          kind: 'composite',
          opacity: 1,
          source: secondary,
          width: 1,
        },
      ],
      h: 1,
      w: 1,
    };
    const filled = renderRegion(
      { entities: [entity(solid(1, 0, 0), { ...common, fill: 0.5, opacity: 1 })] },
      { h: 1, w: 1, x: 0, y: 0 },
      1,
    );
    const faded = renderRegion(
      { entities: [entity(solid(1, 0, 0), { ...common, fill: 1, opacity: 0.5 })] },
      { h: 1, w: 1, x: 0, y: 0 },
      1,
    );
    assert.deepEqual([...filled.data], [0, 0, 1, 1]);
    assert.deepEqual([...faded.data], [0, 0, 0.5, 0.5]);
  });

  it('keys cached tiles by source revision while retaining unrelated entries', () => {
    const cache = new TileCache();
    const data = new Float32Array([1, 0, 0, 1]);
    const graphA = { entities: [entity(image(1, 1, data, 'revision-a'))] };
    const graphB = {
      entities: [entity(solid(0, 1, 0), { id: 'unrelated' })],
    };
    const request = {
      graph: graphA,
      quality: 'preview' as const,
      region: { h: 10, w: 10, x: 0, y: 0 },
      scale: 1,
      targetKey: 'target-a',
    };
    renderTiles(request, cache);
    renderTiles(request, cache);
    renderTiles({ ...request, graph: graphB, targetKey: 'target-b' }, cache);
    const afterWarm = cache.stats();
    assert.deepEqual(afterWarm, { entries: 2, hits: 1, misses: 2 });

    const graphAChanged = { entities: [entity(image(1, 1, data, 'revision-b'))] };
    renderTiles({ ...request, graph: graphAChanged }, cache);
    renderTiles({ ...request, graph: graphB, targetKey: 'target-b' }, cache);
    assert.deepEqual(cache.stats(), { entries: 3, hits: 2, misses: 3 });
  });

  it('projects only the selected Pixelf target and its decoded asset into the engine', () => {
    const asset = createEmbeddedImageAsset({
      bytesBase64: 'AA==',
      contentHash: `sha256:${'d'.repeat(64)}`,
      height: 1,
      id: 'asset-projection',
      mediaType: 'image/png',
      name: 'Projection',
      width: 2,
    });
    const project = cloneProject(
      createImportedProject(asset, {
        layerId: 'node-layer',
        projectId: 'project-projection',
        sourceId: 'node-source',
        targetId: 'node-target',
      }),
    );
    const target = project.nodes['node-target'];
    const layer = project.nodes['node-layer'];
    assert.ok(target?.type === 'target');
    assert.ok(layer?.type === 'layer');
    target.contract.width = 40;
    target.contract.height = 30;
    layer.parameters.opacity = 0.5;
    const opacity = createNode('process/opacity', 'node-opacity') as ProcessorNode;
    opacity.parameters.amount = 0.5;
    opacity.childId = 'node-source';
    project.nodes[opacity.id] = opacity;
    layer.childId = opacity.id;

    const decoded = new Map([
      [
        asset.id,
        { data: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]), height: 1, revision: '1', width: 2 },
      ],
    ]);
    const projection = projectTargetToGraph(project, target.id, decoded);
    assert.match(projection.targetKey, /40x30:rgba:rgba16float:srgb:png:8:preserve/);
    assert.equal(projection.graph.entities.length, 1);
    assert.equal(projection.graph.entities[0]?.w, 40);
    assert.equal(projection.graph.entities[0]?.h, 30);
    assert.equal(projection.graph.entities[0]?.opacity, 0.5);
    assert.deepEqual(projection.graph.entities[0]?.effects, [{ amount: 0.5, kind: 'opacity' }]);
  });
});
