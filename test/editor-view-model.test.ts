import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyProjectCommand,
  createEmbeddedImageAsset,
  createImportedProject,
  createNode,
  nodeRegistry,
} from '../src/project/index.js';
import { createListModel, createPixelfStructureAdapter } from '../src/ui/structure-list/index.js';

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
});
