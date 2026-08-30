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
  applyProjectCommand,
  createEmbeddedImageAsset,
  createImportedProject,
  createNode,
  duplicateSubtreeCommand,
  EditorState,
  nodeRegistry,
  parseProject,
  serializeProject,
  type FilterLayerNode,
  type ContentLayerNode,
  type ProcessorNode,
  type LayerEffectNode,
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
  { amount: 0.2, kind: 'brightness' },
  { gamma: 1.2, inBlack: 0.1, inWhite: 0.9, kind: 'levels', outBlack: 0, outWhite: 1 },
  { kind: 'white-balance', temperature: 0.4, tint: -0.2 },
  { amount: 0.3, kind: 'contrast' },
  { amount: 0.4, kind: 'highlights' },
  { amount: -0.3, kind: 'shadows' },
  { amount: 0.2, kind: 'whites' },
  { amount: -0.2, kind: 'blacks' },
  { amount: 0.4, kind: 'clarity', radius: 1 },
  { amount: 0.5, kind: 'vibrance' },
  { amount: 0.5, kind: 'saturation' },
  { channel: 'alpha', kind: 'channel' },
  { kind: 'blur', sigma: 0.8 },
  { amount: 0.6, kind: 'sharpen', radius: 0.8 },
  { amount: 0.6, kind: 'noise-reduction', radius: 1 },
  { amount: 0.5, height: 3, kind: 'vignette', width: 3 },
  { amount: 0.5, kind: 'grain', seed: 42 },
  { amount: 0.5, kind: 'opacity' },
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
        'process/brightness',
        'process/levels',
        'process/white-balance',
        'process/contrast',
        'process/highlights',
        'process/shadows',
        'process/whites',
        'process/blacks',
        'process/clarity',
        'process/vibrance',
        'process/saturation',
        'process/channel',
        'process/blur',
        'process/sharpen',
        'process/noise-reduction',
        'process/vignette',
        'process/grain',
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
      assert.ok(definition.ports.some(port => port.direction === 'input' && port.kind === 'mask'));
    }
  });

  it('offers the photographic and spatial filters as one interchangeable family', () => {
    assert.deepEqual(
      nodeRegistry.interchangeable('process/exposure').map(definition => definition.type),
      [
        'process/exposure',
        'process/brightness',
        'process/levels',
        'process/white-balance',
        'process/contrast',
        'process/highlights',
        'process/shadows',
        'process/whites',
        'process/blacks',
        'process/clarity',
        'process/vibrance',
        'process/saturation',
        'process/channel',
        'process/blur',
        'process/sharpen',
        'process/noise-reduction',
        'process/vignette',
        'process/grain',
      ],
    );
    assert.deepEqual(nodeRegistry.interchangeable('process/composite'), []);
  });

  it('adds a generic filter layer and switches its operation without replacing it', () => {
    const filter = createNode('filter', 'node-filter') as FilterLayerNode;
    const mask = createNode('source/mask', 'node-filter-mask');
    const inserted = applyProjectCommand(projectFixture(), {
      commands: [
        { node: filter, parentId: 'node-target', type: 'insert-node' },
        { node: mask, parentId: null, type: 'insert-node' },
        {
          type: 'connect',
          wire: {
            from: { nodeId: mask.id, port: 'mask' },
            id: 'wire-filter-mask',
            to: { nodeId: filter.id, port: 'mask' },
          },
        },
      ],
      type: 'batch',
    });
    const target = inserted.nodes['node-target'];
    assert.equal(target?.type, 'target');
    if (target?.type !== 'target') return;
    assert.deepEqual(target.childIds, ['node-layer', filter.id]);
    const brightened = applyProjectCommand(inserted, {
      filterType: 'process/brightness',
      nodeId: filter.id,
      type: 'set-filter-type',
    });
    const adjusted = applyProjectCommand(brightened, {
      key: 'amount',
      nodeId: filter.id,
      type: 'set-parameter',
      value: 25,
    });
    const changed = applyProjectCommand(adjusted, {
      filterType: 'process/clarity',
      nodeId: filter.id,
      type: 'set-filter-type',
    });
    const changedFilter = changed.nodes[filter.id];
    assert.equal(changedFilter?.type, 'filter');
    if (changedFilter?.type !== 'filter') return;
    assert.equal(changedFilter.id, filter.id);
    assert.equal(changedFilter.filterType, 'process/clarity');
    assert.deepEqual(changedFilter.parameters, { amount: 25, bypass: false });
    assert.equal(changed.wires[0]?.to.nodeId, filter.id);
    const projection = projectTargetToGraph(
      changed,
      'node-target',
      new Map([['asset-processing', { data: pixels, height: 3, revision: 'filter', width: 3 }]]),
    );
    assert.equal(projection.graph.filters?.[0]?.id, filter.id);
    assert.equal(projection.graph.filters?.[0]?.position, 1);
    assert.equal(projection.graph.filters?.[0]?.effect.kind, 'clarity');
    assert.ok(projection.graph.filters?.[0]?.effect.mask);
  });

  it('switches a Content Layer among solid, gradient, and pattern generators', () => {
    const content = createNode('content', 'node-content') as ContentLayerNode;
    const inserted = applyProjectCommand(projectFixture(), {
      node: content,
      parentId: 'node-target',
      type: 'insert-node',
    });
    const faded = applyProjectCommand(inserted, {
      key: 'opacity',
      nodeId: content.id,
      type: 'set-parameter',
      value: 0.4,
    });
    const gradient = applyProjectCommand(faded, {
      contentType: 'content/gradient',
      nodeId: content.id,
      type: 'set-content-type',
    });
    const gradientNode = gradient.nodes[content.id];
    assert.equal(gradientNode?.type, 'content');
    if (gradientNode?.type !== 'content') return;
    assert.equal(gradientNode.contentType, 'content/gradient');
    assert.equal(gradientNode.parameters.opacity, 0.4);
    assert.equal(gradientNode.parameters.startColor, '#000000');
    const gradientProjection = projectTargetToGraph(
      gradient,
      'node-target',
      new Map([['asset-processing', { data: pixels, height: 3, revision: 'content', width: 3 }]]),
    );
    assert.equal(gradientProjection.graph.entities[1]?.source.kind, 'linear-gradient');

    const patterned = applyProjectCommand(gradient, {
      contentType: 'content/pattern',
      nodeId: content.id,
      type: 'set-content-type',
    });
    const reopened = parseProject(serializeProject(patterned));
    const patternNode = reopened.nodes[content.id];
    assert.equal(patternNode?.type, 'content');
    if (patternNode?.type !== 'content') return;
    assert.equal(patternNode.id, content.id);
    assert.equal(patternNode.contentType, 'content/pattern');
    assert.equal(patternNode.parameters.opacity, 0.4);
    const patternProjection = projectTargetToGraph(
      reopened,
      'node-target',
      new Map([['asset-processing', { data: pixels, height: 3, revision: 'pattern', width: 3 }]]),
    );
    assert.equal(patternProjection.graph.entities[1]?.source.kind, 'pattern');
  });

  it('owns layer effects with their layer and preserves history-safe identity', () => {
    const state = new EditorState(projectFixture());
    const effect = createNode('effect/drop-shadow', 'node-drop-shadow') as LayerEffectNode;
    state.dispatch(
      { effect, ownerId: 'node-layer', type: 'insert-layer-effect' },
      { label: 'Add drop shadow' },
    );
    const layer = state.project.nodes['node-layer'];
    assert.equal(layer?.type, 'layer');
    if (layer?.type !== 'layer') return;
    assert.deepEqual(layer.effectIds, [effect.id]);
    const projection = projectTargetToGraph(
      state.project,
      'node-target',
      new Map([['asset-processing', { data: pixels, height: 3, revision: 'effect', width: 3 }]]),
    );
    assert.equal(projection.graph.entities[0]?.layerEffects?.[0]?.kind, 'drop-shadow');

    state.dispatch(duplicateSubtreeCommand(state.project, effect.id), {
      label: 'Duplicate layer effect',
    });
    const duplicatedOwner = state.project.nodes['node-layer'];
    assert.equal(duplicatedOwner?.type, 'layer');
    if (duplicatedOwner?.type !== 'layer') return;
    assert.equal(duplicatedOwner.effectIds.length, 2);
    state.dispatch(
      { effectId: effect.id, enabled: false, type: 'set-layer-effect-enabled' },
      { label: 'Disable layer effect' },
    );
    assert.equal(state.project.nodes[effect.id]?.type, 'effect/drop-shadow');
    state.undo();
    const restored = state.project.nodes[effect.id];
    assert.ok(restored && 'enabled' in restored && restored.enabled);

    state.dispatch({ nodeId: 'node-layer', type: 'remove-node' }, { label: 'Delete layer' });
    assert.equal(state.project.nodes[effect.id], undefined);
    assert.equal(
      Object.values(state.project.nodes).some(node => node.type.startsWith('effect/')),
      false,
    );
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
      candidate =>
        candidate.kind === 'blur' ||
        candidate.kind === 'clarity' ||
        candidate.kind === 'noise-reduction' ||
        candidate.kind === 'sharpen',
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

  it('limits an individual adjustment with its own mask', () => {
    const graph: Graph = {
      entities: [
        {
          blend: 'normal',
          effects: [
            {
              amount: 1,
              kind: 'brightness',
              mask: {
                density: 1,
                effects: [],
                h: 1,
                invert: false,
                source: { first: 0, kind: 'checker', offsetX: 0, offsetY: 0, second: 1, size: 1 },
                w: 2,
                x: 0,
                y: 0,
              },
            },
          ],
          h: 1,
          id: 'adjustment-mask',
          opacity: 1,
          source: solid(0.25, 0.25, 0.25),
          w: 2,
          x: 0,
          y: 0,
        },
      ],
    };
    const output = renderRegion(graph, { h: 1, w: 2, x: 0, y: 0 }, 1);
    assert.deepEqual([...output.data], [0.25, 0.25, 0.25, 1, 0.5, 0.5, 0.5, 1]);
  });

  it('keeps deterministic grain identical across full and tiled evaluation', () => {
    const graph: Graph = { entities: [entity({ amount: 0.8, kind: 'grain', seed: 27 })] };
    const region = { h: 3, w: 3, x: 0, y: 0 };
    const full = renderRegion(graph, region, 1);
    const tiled = assembleTiles(
      renderTiles({ graph, quality: 'final', region, scale: 1, targetKey: 'grain' }),
      region,
    );
    assert.deepEqual([...tiled.data], [...full.data]);
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

  it('projects a typed processor mask onto its adjustment effect', () => {
    const project = projectFixture();
    const layer = project.nodes['node-layer'];
    assert.equal(layer?.type, 'layer');
    if (layer?.type !== 'layer') return;
    const adjustment = createNode('process/brightness', 'node-brightness') as ProcessorNode;
    adjustment.parameters.amount = 50;
    adjustment.childId = layer.childId;
    layer.childId = adjustment.id;
    project.nodes[adjustment.id] = adjustment;
    const mask = createNode('source/checker-mask', 'node-adjustment-mask');
    project.nodes[mask.id] = mask;
    project.wires.push({
      from: { nodeId: mask.id, port: 'mask' },
      id: 'wire-adjustment-mask',
      to: { nodeId: adjustment.id, port: 'mask' },
    });
    const projection = projectTargetToGraph(
      project,
      'node-target',
      new Map([['asset-processing', { data: pixels, height: 3, revision: 'mask', width: 3 }]]),
    );
    assert.equal(projection.graph.entities[0]?.effects[0]?.kind, 'brightness');
    assert.ok(projection.graph.entities[0]?.effects[0]?.mask);
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
