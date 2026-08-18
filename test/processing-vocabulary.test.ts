import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assembleTiles,
  image,
  projectTargetToGraph,
  renderRegion,
  renderTiles,
  solid,
  type Effect,
  type Entity,
  type Graph,
} from '../src/compositor/index.js';
import {
  flattenGraphForGpu,
  premultipliedSrgbMipLevels,
  referenceSurfaceBytes,
} from '../src/gpu/index.js';
import {
  createEmbeddedImageAsset,
  createImportedProject,
  createNode,
  duplicateSubtreeCommand,
  EditorState,
  nodeRegistry,
  parseProject,
  serializeProject,
  type ProcessorNode,
} from '../src/project/index.js';

const pixels = new Float32Array([
  1, 0, 0, 1, 0.5, 0.25, 0.1, 0.5, 0, 0, 1, 0, 0, 1, 0, 1, 0.25, 0.5, 0.75, 1, 1, 1, 1, 0.5, 0, 0,
  0, 1, 0.2, 0.4, 0.6, 1, 1, 1, 1, 1,
]);

function entity(effect: Effect): Entity {
  return {
    blend: 'normal',
    effects: [effect],
    h: 3,
    id: `entity-${effect.kind}`,
    opacity: 1,
    source: image(3, 3, pixels, 'processing-source'),
    w: 3,
    x: 0,
    y: 0,
  };
}

const effects: readonly Effect[] = [
  { height: 2, kind: 'crop', width: 2, x: 0, y: 0 },
  { height: 2, kind: 'canvas-resize', width: 3, x: 0, y: 1 },
  { kind: 'affine', pivotX: 1, pivotY: 1, rotation: 15, scaleX: 1, scaleY: 1, x: 0, y: 0 },
  { kind: 'exposure', stops: 0.5 },
  { gamma: 1.2, inBlack: 0.1, inWhite: 0.9, kind: 'levels', outBlack: 0, outWhite: 1 },
  { kind: 'white-balance', temperature: 0.4, tint: -0.2 },
  { amount: 0.3, kind: 'contrast' },
  { amount: 0.5, kind: 'saturation' },
  { channel: 'alpha', kind: 'channel' },
  { kind: 'blur', sigma: 0.8 },
  { amount: 0.6, kind: 'sharpen', radius: 0.8 },
];

function projectFixture() {
  const asset = createEmbeddedImageAsset({
    bytesBase64: 'AA==',
    contentHash: `sha256:${'e'.repeat(64)}`,
    height: 3,
    id: 'asset-processing',
    mediaType: 'image/png',
    name: 'Processing',
    width: 3,
  });
  return createImportedProject(asset, {
    layerId: 'node-layer',
    projectId: 'project-processing',
    sourceId: 'node-source',
    targetId: 'node-target',
  });
}

describe('reversible processing vocabulary', () => {
  it('registers every operation with parameters, regions, quality, and runners', () => {
    const processors = nodeRegistry.all().filter(definition => definition.kind === 'processor');
    assert.deepEqual(
      processors.map(definition => definition.type),
      [
        'process/crop',
        'process/canvas-resize',
        'process/affine',
        'process/opacity',
        'process/exposure',
        'process/levels',
        'process/white-balance',
        'process/contrast',
        'process/saturation',
        'process/channel',
        'process/blur',
        'process/sharpen',
        'process/composite',
        'process/adjustment-group',
      ],
    );
    for (const definition of processors) {
      assert.ok(definition.parameters.some(parameter => parameter.key === 'bypass'));
      assert.ok(definition.execution);
      assert.equal(definition.execution.cpuRunner, 'reference');
      assert.ok(['cpu-upload', 'direct'].includes(definition.execution.gpuRunner));
      assert.ok(definition.region.kind);
    }
  });

  it('evaluates and GPU-encodes every pixel operation with matching alpha-safe bytes', () => {
    for (const effect of effects) {
      const graph: Graph = { entities: [entity(effect)] };
      const reference = renderRegion(graph, { h: 3, w: 3, x: 0, y: 0 }, 1);
      const flattened = flattenGraphForGpu(graph, 3, 3);
      const source = flattened.entities[0]?.source;
      assert.equal(source?.kind, 'image', effect.kind);
      if (source?.kind !== 'image') continue;
      assert.deepEqual(
        [...(premultipliedSrgbMipLevels(source)[0]?.data ?? [])],
        [...referenceSurfaceBytes(reference)],
        effect.kind,
      );
    }
  });

  it('keeps halo operations equal across isolated tile boundaries', () => {
    for (const effect of effects.filter(
      candidate => candidate.kind === 'blur' || candidate.kind === 'sharpen',
    )) {
      const graph: Graph = {
        entities: [
          {
            ...entity(effect),
            h: 3,
            matrix: [1, 0, 0, 1, 255, 255],
            w: 3,
          },
        ],
      };
      const region = { h: 5, w: 5, x: 254, y: 254 };
      const full = renderRegion(graph, region, 1);
      const tiled = assembleTiles(
        renderTiles({ graph, quality: 'final', region, scale: 1, targetKey: effect.kind }),
        region,
      );
      assert.deepEqual([...tiled.data], [...full.data], effect.kind);
    }
  });

  it('applies mask density, invert, feather, and transform without changing source pixels', () => {
    const graph: Graph = {
      entities: [
        {
          blend: 'normal',
          effects: [],
          h: 3,
          id: 'masked',
          mask: {
            density: 0.5,
            effects: [{ kind: 'blur', sigma: 0.5 }],
            h: 2,
            invert: true,
            matrix: [1, 0, 0, 1, 1, 0],
            source: solid(0.25, 0.25, 0.25),
            w: 2,
            x: 0,
            y: 0,
          },
          opacity: 1,
          source: solid(1, 0, 0),
          w: 3,
          x: 0,
          y: 0,
        },
      ],
    };
    const output = renderRegion(graph, { h: 3, w: 3, x: 0, y: 0 }, 1);
    const alpha = [output.data[3] ?? 0, output.data[7] ?? 0, output.data[11] ?? 0];
    assert.ok(alpha.every(value => value > 0 && value <= 0.5));
    assert.ok(new Set(alpha).size > 1);
    assert.equal(graph.entities[0]?.source.kind, 'solid');
  });

  it('projects every registry operation and preserves authored parameters through reload', () => {
    const decoded = new Map([
      ['asset-processing', { data: pixels, height: 3, revision: 'one', width: 3 }],
    ]);
    for (const definition of nodeRegistry
      .all()
      .filter(candidate => candidate.kind === 'processor')) {
      const project = projectFixture();
      const layer = project.nodes['node-layer'];
      assert.equal(layer?.type, 'layer');
      if (layer?.type !== 'layer') continue;
      const processor = createNode(
        definition.type,
        `node-${definition.type.replace('/', '-')}`,
      ) as ProcessorNode;
      if (processor.type === 'process/composite') processor.parameters.bypass = true;
      processor.childId = layer.childId;
      layer.childId = processor.id;
      project.nodes[processor.id] = processor;
      const reloaded = parseProject(serializeProject(project));
      const projection = projectTargetToGraph(reloaded, 'node-target', decoded);
      assert.equal(projection.graph.entities.length, 1, definition.type);
    }
  });

  it('duplicates reusable branches and makes rasterization an undoable visible boundary', () => {
    const state = new EditorState(projectFixture());
    state.dispatch(duplicateSubtreeCommand(state.project, 'node-layer'), { label: 'Duplicate' });
    const target = state.project.nodes['node-target'];
    assert.equal(target?.type, 'target');
    if (target?.type === 'target') assert.equal(target.childIds.length, 2);
    assert.equal(Object.keys(state.project.assets).length, 1);

    const replacement = createEmbeddedImageAsset({
      bytesBase64: 'AQ==',
      contentHash: `sha256:${'f'.repeat(64)}`,
      height: 3,
      id: 'asset-rasterized',
      mediaType: 'image/png',
      name: 'Rasterized',
      width: 3,
    });
    state.dispatch({
      asset: replacement,
      mode: 'new-asset',
      nodeId: 'node-source',
      sourceId: 'node-rasterized',
      type: 'rasterize-node',
    });
    assert.equal(state.project.nodes['node-source'], undefined);
    assert.equal(state.project.nodes['node-rasterized']?.type, 'source/imported');
    state.undo();
    assert.equal(
      Object.values(state.project.nodes).some(
        node => node.id === 'node-source' && node.type === 'source/imported',
      ),
      true,
    );
    assert.equal(state.project.nodes['node-rasterized'], undefined);
  });
});
