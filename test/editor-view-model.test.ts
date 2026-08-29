import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyProjectCommand,
  createEmbeddedImageAsset,
  createImportedProject,
  createNode,
  nodeRegistry,
} from '../src/project/index.js';
import {
  createListModel,
  createPixelfLayerStackAdapter,
  createPixelfStructureAdapter,
  pixelfNodeSummary,
} from '../src/ui/structure-list/index.js';

function projectWithMask() {
  const asset = createEmbeddedImageAsset({
    bytesBase64: 'AA==',
    contentHash: `sha256:${'e'.repeat(64)}`,
    height: 40,
    id: 'asset-view',
    mediaType: 'image/png',
    name: 'View image',
    width: 50,
  });
  const project = createImportedProject(asset, {
    layerId: 'node-layer',
    projectId: 'project-view',
    sourceId: 'node-source',
    targetId: 'node-target',
  });
  const mask = createNode('source/mask', 'node-mask', 'Mask');
  return applyProjectCommand(project, {
    commands: [
      { node: mask, parentId: null, type: 'insert-node' },
      {
        type: 'connect',
        wire: {
          from: { nodeId: mask.id, port: 'mask' },
          id: 'wire-mask',
          to: { nodeId: 'node-layer', port: 'mask' },
        },
      },
    ],
    type: 'batch',
  });
}

describe('target-first editor view model', () => {
  it('lists the target and primary branch without treating mask wires as ordered rows', () => {
    const project = projectWithMask();
    const model = createListModel(
      {
        expanded: new Set(['node-target', 'node-layer', 'node-source']),
        project,
        revision: 'view-1',
      },
      createPixelfStructureAdapter(),
      () => 48,
    );
    assert.deepEqual(
      model.rows.map(row => [row.nodeId, row.depth, row.relation]),
      [
        ['node-target', 0, 'root'],
        ['node-layer', 1, 'ordered-child'],
        ['node-source', 2, 'unary-child'],
      ],
    );
    assert.equal(project.wires[0]?.from.nodeId, 'node-mask');
    assert.deepEqual(
      createListModel(
        { expanded: new Set<string>(), project, revision: 'view-2' },
        createPixelfStructureAdapter(),
        () => 48,
      ).rows.map(row => row.nodeId),
      ['node-target'],
    );
  });

  it('keeps insertion and property UI schema-driven', () => {
    const opacity = nodeRegistry.require('process/opacity');
    assert.equal(opacity.childPolicy, 'one');
    assert.deepEqual(
      opacity.parameters.map(parameter => parameter.key),
      ['amount', 'bypass'],
    );
    assert.equal(
      nodeRegistry.require('layer').ports.find(port => port.key === 'mask')?.kind,
      'mask',
    );
  });

  it('folds imported bitmap sources into a top-first layer stack', () => {
    const topSource = createNode('source/imported', 'node-top-source', 'Top source');
    assert.equal(topSource.type, 'source/imported');
    if (topSource.type !== 'source/imported') return;
    topSource.assetId = 'asset-view';
    const topLayer = createNode('layer', 'node-top-layer', 'Top layer');
    assert.equal(topLayer.type, 'layer');
    if (topLayer.type !== 'layer') return;
    topLayer.childId = topSource.id;
    const project = applyProjectCommand(projectWithMask(), {
      commands: [
        { node: topSource, parentId: null, type: 'insert-node' },
        { node: topLayer, parentId: 'node-target', type: 'insert-node' },
      ],
      type: 'batch',
    });
    const model = createListModel(
      {
        expanded: new Set(['node-layer', 'node-source', 'node-top-layer']),
        project,
        revision: 'view-stack-1',
      },
      createPixelfLayerStackAdapter(),
      () => 48,
    );
    assert.deepEqual(
      model.rows.map(row => [row.nodeId, row.name, row.depth, row.relation]),
      [
        ['node-top-layer', 'Top layer', 0, 'root'],
        ['node-layer', 'View image', 0, 'root'],
        ['node-target', 'View image', 0, 'root'],
      ],
    );
    assert.equal(model.rows[0]?.hasChildren, false);
    assert.equal(pixelfNodeSummary(project, topLayer), '50 x 40 / embedded');
  });

  it('keeps processors disclosed while folding their terminal bitmap source', () => {
    const project = projectWithMask();
    const blur = createNode('process/blur', 'node-blur', 'Soft focus');
    const withBlur = applyProjectCommand(project, {
      commands: [
        { index: 0, nodeId: 'node-source', parentId: null, type: 'move-node' },
        { node: blur, parentId: 'node-layer', type: 'insert-node' },
        { index: 0, nodeId: 'node-source', parentId: blur.id, type: 'move-node' },
      ],
      type: 'batch',
    });
    const model = createListModel(
      {
        expanded: new Set(['node-layer', blur.id]),
        project: withBlur,
        revision: 'view-stack-processor',
      },
      createPixelfLayerStackAdapter(),
      () => 48,
    );
    assert.deepEqual(
      model.rows.map(row => [row.nodeId, row.depth, row.relation, row.hasChildren]),
      [
        ['node-layer', 0, 'root', true],
        [blur.id, 1, 'unary-child', false],
        ['node-target', 0, 'root', false],
      ],
    );
    const layer = withBlur.nodes['node-layer'];
    assert.ok(layer);
    assert.equal(pixelfNodeSummary(withBlur, layer), '50 x 40 / embedded');
  });
});
