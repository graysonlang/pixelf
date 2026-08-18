import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analyzeSurface,
  createBoundedWorkPlan,
  runBoundedIterations,
  sharedBranchCacheKey,
} from '../src/advanced/index.js';
import { projectTargetToGraph, renderRegion } from '../src/compositor/index.js';
import {
  createEmbeddedImageAsset,
  createImportedProject,
  createNode,
  parseProject,
  serializeProject,
  type ProcessorNode,
  type SourceNode,
} from '../src/project/index.js';
import { projectTreeEntries } from '../src/ui/editor-view.js';

function asset(id: string, hashCharacter: string) {
  return createEmbeddedImageAsset({
    bytesBase64: 'AA==',
    contentHash: `sha256:${hashCharacter.repeat(64)}`,
    height: 1,
    id,
    mediaType: 'image/png',
    name: id,
    width: 4,
  });
}

function projectFixture() {
  return createImportedProject(asset('asset-primary', 'a'), {
    layerId: 'node-layer',
    projectId: 'project-advanced',
    sourceId: 'node-primary',
    targetId: 'node-target',
  });
}

const primaryPixels = new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);

describe('advanced wiring and bounded extensibility', () => {
  it('reuses a shared image branch through a visible typed dependency and stable lifetime key', () => {
    const project = projectFixture();
    const layer = project.nodes['node-layer'];
    assert.equal(layer?.type, 'layer');
    if (layer?.type !== 'layer') return;
    const shared = createNode('source/shared', 'node-shared') as SourceNode;
    shared.parameters.cacheLifetime = 'project';
    project.nodes[shared.id] = shared;
    layer.childId = shared.id;
    project.wires.push({
      from: { nodeId: 'node-primary', port: 'image' },
      id: 'wire-shared',
      to: { nodeId: shared.id, port: 'input' },
    });
    const reloaded = parseProject(serializeProject(project));
    const entries = projectTreeEntries(reloaded, new Set(['node-target', 'node-layer', shared.id]));
    assert.ok(
      entries.some(
        entry => entry.node.id === 'node-primary' && entry.relationship === 'input input',
      ),
    );
    const key = sharedBranchCacheKey(reloaded, shared.id, {
      sessionId: 'session-one',
      targetId: 'node-target',
    });
    assert.equal(
      sharedBranchCacheKey(reloaded, shared.id, {
        sessionId: 'session-two',
        targetId: 'another-target',
      }),
      key,
    );
    const projection = projectTargetToGraph(
      reloaded,
      'node-target',
      new Map([
        ['asset-primary', { data: primaryPixels, height: 1, revision: 'primary', width: 4 }],
      ]),
    );
    assert.deepEqual(
      [...renderRegion(projection.graph, { h: 1, w: 4, x: 0, y: 0 }, 1).data],
      [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
    );
  });

  it('evaluates a declared secondary image through a two-input composite', () => {
    const project = projectFixture();
    const secondaryAsset = asset('asset-secondary', 'b');
    project.assets[secondaryAsset.id] = secondaryAsset;
    const secondary = createNode('source/imported', 'node-secondary') as SourceNode;
    secondary.assetId = secondaryAsset.id;
    project.nodes[secondary.id] = secondary;
    const composite = createNode('process/composite', 'node-composite') as ProcessorNode;
    composite.childId = 'node-primary';
    composite.parameters.opacity = 0.5;
    project.nodes[composite.id] = composite;
    const layer = project.nodes['node-layer'];
    assert.equal(layer?.type, 'layer');
    if (layer?.type !== 'layer') return;
    layer.childId = composite.id;
    project.wires.push({
      from: { nodeId: secondary.id, port: 'image' },
      id: 'wire-composite',
      to: { nodeId: composite.id, port: 'secondary' },
    });
    const blue = new Float32Array([0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]);
    const projection = projectTargetToGraph(
      parseProject(serializeProject(project)),
      'node-target',
      new Map([
        ['asset-primary', { data: primaryPixels, height: 1, revision: 'primary', width: 4 }],
        ['asset-secondary', { data: blue, height: 1, revision: 'secondary', width: 4 }],
      ]),
    );
    assert.deepEqual(
      [...renderRegion(projection.graph, { h: 1, w: 1, x: 0, y: 0 }, 1).data],
      [0.5, 0, 0.5, 1],
    );
  });

  it('keeps procedural masks and scoped adjustment groups navigable in the layer tree', () => {
    const project = projectFixture();
    const target = project.nodes['node-target'];
    const layer = project.nodes['node-layer'];
    assert.equal(target?.type, 'target');
    assert.equal(layer?.type, 'layer');
    if (target?.type !== 'target' || layer?.type !== 'layer') return;
    target.contract.width = 4;
    const group = createNode('process/adjustment-group', 'node-group') as ProcessorNode;
    group.parameters.amount = 0.5;
    group.childId = layer.childId;
    project.nodes[group.id] = group;
    layer.childId = group.id;
    const mask = createNode('source/checker-mask', 'node-checker') as SourceNode;
    mask.parameters.size = 1;
    project.nodes[mask.id] = mask;
    project.wires.push({
      from: { nodeId: mask.id, port: 'mask' },
      id: 'wire-checker',
      to: { nodeId: layer.id, port: 'mask' },
    });
    const projection = projectTargetToGraph(
      parseProject(serializeProject(project)),
      target.id,
      new Map([
        ['asset-primary', { data: primaryPixels, height: 1, revision: 'primary', width: 4 }],
      ]),
    );
    const output = renderRegion(projection.graph, { h: 1, w: 4, x: 0, y: 0 }, 1);
    assert.deepEqual(
      [output.data[3], output.data[7], output.data[11], output.data[15]],
      [0, 0.5, 0, 0.5],
    );
    const entries = projectTreeEntries(project, new Set(Object.keys(project.nodes)));
    assert.ok(entries.some(entry => entry.node.id === group.id));
    assert.ok(
      entries.some(entry => entry.node.id === mask.id && entry.relationship === 'mask input'),
    );
  });

  it('derives histogram and scope diagnostics without changing serialized image state', () => {
    const project = projectFixture();
    const before = serializeProject(project);
    const projection = projectTargetToGraph(
      project,
      'node-target',
      new Map([
        ['asset-primary', { data: primaryPixels, height: 1, revision: 'primary', width: 4 }],
      ]),
    );
    const surface = renderRegion(projection.graph, { h: 1, w: 4, x: 0, y: 0 }, 1);
    const analysis = analyzeSurface(surface, 16);
    assert.equal(
      analysis.histogram.red.reduce((sum, value) => sum + value, 0),
      4,
    );
    assert.deepEqual(analysis.mean, [1, 0, 0, 1]);
    assert.equal(analysis.alphaCoverage, 1);
    assert.ok(analysis.vectorscope.length > 0);
    assert.equal(serializeProject(project), before);
  });

  it('bounds iterative compute work by iterations, dispatches, memory, and cancellation', async () => {
    const plan = createBoundedWorkPlan({
      bytesPerPixel: 8,
      height: 64,
      iterations: 5,
      maxBytes: 64 * 64 * 8 * 2,
      maxIterations: 10,
      maxWorkgroups: 1000,
      width: 64,
    });
    assert.deepEqual(
      [plan.iterations, plan.workgroupsPerIteration, plan.pingPongBuffers],
      [5, 64, 2],
    );
    const controller = new AbortController();
    const completed = await runBoundedIterations(
      plan,
      iteration => {
        if (iteration === 2) controller.abort();
      },
      controller.signal,
    );
    assert.equal(completed, 3);
    assert.throws(
      () =>
        createBoundedWorkPlan({
          ...plan,
          bytesPerPixel: 8,
          maxBytes: 1,
          maxIterations: 10,
          maxWorkgroups: 1000,
        }),
      /memory limit/,
    );
    assert.throws(
      () =>
        createBoundedWorkPlan({
          ...plan,
          bytesPerPixel: 8,
          iterations: 20,
          maxBytes: 100000,
          maxIterations: 10,
          maxWorkgroups: 10000,
        }),
      /iteration limit/,
    );
  });
});
