import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createListModel,
  findTypeaheadIndex,
  normalizedSelection,
  type Row,
  type StructureAdapter,
} from '../../src/ui/structure-list/index.js';

interface FixtureNode {
  children: string[];
  expanded: boolean;
  name: string;
  parentId: string | null;
  relation: Row['relation'];
}

interface Fixture {
  nodes: Record<string, FixtureNode>;
  roots: string[];
}

const fixture: Fixture = {
  nodes: {
    target: {
      children: ['layer-a', 'layer-b'],
      expanded: true,
      name: 'Target',
      parentId: null,
      relation: 'root',
    },
    'layer-a': {
      children: ['source-a'],
      expanded: true,
      name: 'Foreground',
      parentId: 'target',
      relation: 'ordered-child',
    },
    'source-a': {
      children: [],
      expanded: false,
      name: 'Portrait',
      parentId: 'layer-a',
      relation: 'unary-child',
    },
    'layer-b': {
      children: [],
      expanded: false,
      name: 'Background',
      parentId: 'target',
      relation: 'ordered-child',
    },
  },
  roots: ['target'],
};

function adapter(childOrder: 'document' | 'reversed'): StructureAdapter<Fixture> {
  return {
    childOrder,
    childrenOf: (snapshot, id) => snapshot.nodes[id]?.children ?? [],
    describe: (snapshot, id) => {
      const node = snapshot.nodes[id];
      assert.ok(node);
      return {
        acceptsVisualDepth: id !== 'target',
        expanded: node.expanded,
        hasChildren: node.children.length > 0,
        kind: id.startsWith('layer') ? 'layer' : id.startsWith('source') ? 'source' : 'target',
        name: node.name,
        nodeId: id,
        parentId: node.parentId,
        relation: node.relation,
        selectable: true,
      };
    },
    revisionOf: () => 'fixture-1',
    rootsOf: snapshot => snapshot.roots,
  };
}

describe('structure list model', () => {
  it('flattens expanded nodes with analytic row geometry', () => {
    const model = createListModel(fixture, adapter('document'), row => 40 + row.depth * 2);
    assert.deepEqual(
      model.rows.map(row => [row.nodeId, row.depth, row.documentIndex, row.height]),
      [
        ['target', 0, 0, 40],
        ['layer-a', 1, 0, 42],
        ['source-a', 2, 0, 44],
        ['layer-b', 1, 1, 42],
      ],
    );
    assert.deepEqual(Array.from(model.rowTop), [0, 40, 82, 126, 168]);
    assert.equal(model.totalHeight, 168);
  });

  it('reverses display order without changing canonical child indexes', () => {
    const model = createListModel(fixture, adapter('reversed'), () => 48);
    assert.deepEqual(
      model.rows.map(row => [row.nodeId, row.documentIndex]),
      [
        ['target', 0],
        ['layer-b', 1],
        ['layer-a', 0],
        ['source-a', 0],
      ],
    );
  });

  it('keeps focus and selection distinct while normalizing missing nodes', () => {
    const model = createListModel(fixture, adapter('document'), () => 48);
    assert.deepEqual(
      normalizedSelection(model, {
        focusedNodeId: 'source-a',
        selectedNodeId: 'layer-b',
      }),
      { focusedNodeId: 'source-a', selectedNodeId: 'layer-b' },
    );
    assert.deepEqual(
      normalizedSelection(model, { focusedNodeId: 'missing', selectedNodeId: 'missing' }),
      { focusedNodeId: 'target', selectedNodeId: 'target' },
    );
  });

  it('finds the next visible type-ahead match by name', () => {
    const model = createListModel(fixture, adapter('document'), () => 48);
    assert.equal(findTypeaheadIndex(model, 'b', 0), 3);
    assert.equal(findTypeaheadIndex(model, 'por', 3), 2);
    assert.equal(findTypeaheadIndex(model, 'missing', 0), -1);
  });
});
