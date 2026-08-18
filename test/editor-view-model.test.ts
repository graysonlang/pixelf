import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyProjectCommand,
  createEmbeddedImageAsset,
  createImportedProject,
  createNode,
  nodeRegistry,
} from '../src/project/index.js';
import { projectTreeEntries } from '../src/ui/editor-view.js';

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
  it('lists the target, ordered primary branch, and declared mask relationship', () => {
    const project = projectWithMask();
    const entries = projectTreeEntries(
      project,
      new Set(['node-target', 'node-layer', 'node-source']),
    );
    assert.deepEqual(
      entries.map(entry => [entry.node.id, entry.depth, entry.relationship ?? 'primary']),
      [
        ['node-target', 0, 'primary'],
        ['node-layer', 1, 'primary'],
        ['node-source', 2, 'primary'],
        ['node-mask', 2, 'mask input'],
      ],
    );
    assert.deepEqual(
      projectTreeEntries(project, new Set()).map(entry => entry.node.id),
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
