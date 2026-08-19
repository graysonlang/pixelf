import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createEmbeddedImageAsset,
  createImportedProject,
  createNode,
  EditorState,
  type ProcessorNode,
} from '../src/project/index.js';

function editor(): EditorState {
  const asset = createEmbeddedImageAsset({
    bytesBase64: 'AA==',
    contentHash: `sha256:${'c'.repeat(64)}`,
    height: 64,
    id: 'asset-editor',
    mediaType: 'image/png',
    name: 'Editor image',
    width: 96,
  });
  return new EditorState(
    createImportedProject(asset, {
      layerId: 'node-layer',
      projectId: 'project-editor',
      sourceId: 'node-source',
      targetId: 'node-target',
    }),
  );
}

function editorNode(state: EditorState, nodeId: string) {
  const node = state.project.nodes[nodeId];
  assert.ok(node);
  return node;
}

describe('EditorState', () => {
  it('inserts a processor, edits it, and traverses undo and redo', () => {
    const state = editor();
    const opacity = createNode('process/opacity', 'node-opacity') as ProcessorNode;
    state.dispatch(
      {
        commands: [
          { node: opacity, parentId: null, type: 'insert-node' },
          { index: 0, nodeId: 'node-source', parentId: 'node-opacity', type: 'move-node' },
          { index: 0, nodeId: 'node-opacity', parentId: 'node-layer', type: 'move-node' },
        ],
        type: 'batch',
      },
      { label: 'Insert opacity' },
    );
    state.dispatch(
      { key: 'amount', nodeId: 'node-opacity', type: 'set-parameter', value: 0.4 },
      { label: 'Opacity', mergeKey: 'node-opacity:amount', now: 10 },
    );
    state.dispatch(
      { key: 'amount', nodeId: 'node-opacity', type: 'set-parameter', value: 0.3 },
      { label: 'Opacity', mergeKey: 'node-opacity:amount', now: 100 },
    );

    assert.equal(editorNode(state, 'node-opacity').parameters.amount, 0.3);
    state.undo();
    assert.equal(editorNode(state, 'node-opacity').parameters.amount, 1);
    state.undo();
    assert.equal(state.project.nodes['node-opacity'], undefined);
    state.redo();
    state.redo();
    assert.equal(editorNode(state, 'node-opacity').parameters.amount, 0.3);
  });

  it('supports transactional previews, cancellation, insertion, reorder, and removal', () => {
    const state = editor();
    state.beginTransaction('Fade layer');
    state.preview({ key: 'opacity', nodeId: 'node-layer', type: 'set-parameter', value: 0.6 });
    state.preview({ key: 'opacity', nodeId: 'node-layer', type: 'set-parameter', value: 0.2 });
    state.cancelTransaction();
    assert.equal(editorNode(state, 'node-layer').parameters.opacity, 1);

    state.beginTransaction('Fade layer');
    state.preview({ key: 'opacity', nodeId: 'node-layer', type: 'set-parameter', value: 0.2 });
    state.commitTransaction(100);
    state.undo();
    assert.equal(editorNode(state, 'node-layer').parameters.opacity, 1);

    const secondLayer = createNode('layer', 'node-layer-two');
    state.dispatch({ index: 0, node: secondLayer, parentId: 'node-target', type: 'insert-node' });
    const target = editorNode(state, 'node-target');
    assert.equal(target.type, 'target');
    if (target.type === 'target')
      assert.deepEqual(target.childIds, ['node-layer-two', 'node-layer']);
    state.dispatch({
      index: 1,
      nodeId: 'node-layer-two',
      parentId: 'node-target',
      type: 'move-node',
    });
    if (target.type === 'target') {
      const movedTarget = editorNode(state, 'node-target');
      if (movedTarget.type === 'target') {
        assert.deepEqual(movedTarget.childIds, ['node-layer', 'node-layer-two']);
      }
    }
    state.dispatch({ nodeId: 'node-layer-two', type: 'remove-node' });
    assert.equal(state.project.nodes['node-layer-two'], undefined);
  });

  it('keeps ephemeral selection, panels, playback, and renderer state out of dirty tracking', () => {
    const state = editor();
    assert.equal(state.dirty, false);
    state.select(['node-layer']);
    state.setPanelOpen('properties', true);
    state.setPlayback(2.5, true);
    state.setRendererStatus('ready');
    assert.equal(state.dirty, false);

    state.dispatch({ key: 'opacity', nodeId: 'node-layer', type: 'set-parameter', value: 0.5 });
    assert.equal(state.dirty, true);
    state.markSaved();
    assert.equal(state.dirty, false);
  });

  it('stores canvas backgrounds in undoable target state', () => {
    const state = editor();
    state.dispatch({
      background: {
        color: { a: 1, b: 0.25, g: 0.5, r: 0.75 },
        mode: 'custom',
        visible: true,
      },
      nodeId: 'node-target',
      type: 'set-target-background',
    });
    const changed = editorNode(state, 'node-target');
    assert.equal(changed.type, 'target');
    if (changed.type === 'target') assert.equal(changed.background?.mode, 'custom');
    state.undo();
    const restored = editorNode(state, 'node-target');
    assert.equal(restored.type, 'target');
    if (restored.type === 'target') assert.equal(restored.background, undefined);
  });
});
