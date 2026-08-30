import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assetAvailability,
  cloneProject,
  createEmbeddedImageAsset,
  createImportedProject,
  createLinkedImageAsset,
  createNode,
  createUntitledCompositeProject,
  parseProject,
  ProjectValidationError,
  resolveTargetContract,
  serializeProject,
  validateProject,
  type PixelfProject,
  type ProcessorNode,
} from '../src/project/index.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

function embeddedAsset() {
  return createEmbeddedImageAsset({
    bytesBase64: 'AAECAw==',
    contentHash: HASH_A,
    height: 600,
    id: 'asset-photo',
    mediaType: 'image/png',
    name: 'Photo',
    width: 800,
  });
}

function importedProject(): PixelfProject {
  return createImportedProject(embeddedAsset(), {
    layerId: 'node-layer',
    projectId: 'project-test',
    sourceId: 'node-source',
    targetId: 'node-target',
  });
}

function projectNode(project: PixelfProject, nodeId: string) {
  const node = project.nodes[nodeId];
  assert.ok(node);
  return node;
}

describe('Pixelf project document', () => {
  it('round-trips a target-first imported project byte-stably', () => {
    const project = importedProject();
    const source = serializeProject(project);
    const parsed = parseProject(source);

    assert.equal(serializeProject(parsed), source);
    assert.deepEqual(parsed.nodes['node-target'], {
      childIds: ['node-layer'],
      contract: {
        alphaPolicy: 'preserve',
        channels: 'rgba',
        colorSpace: 'automatic',
        height: 600,
        outputBitDepth: 8,
        outputFormat: 'png',
        width: 800,
        workingFormat: 'rgba16float',
      },
      id: 'node-target',
      name: 'Photo',
      parameters: {},
      type: 'target',
    });
    const layer = projectNode(parsed, 'node-layer');
    assert.equal(layer.type, 'layer');
    if (layer.type === 'layer') {
      assert.deepEqual(layer.effectIds, []);
      assert.equal(layer.visible, true);
      assert.equal(layer.locked, false);
    }
  });

  it('migrates the explicit version-zero bit-depth field', () => {
    const legacy = cloneProject(importedProject()) as unknown as Record<string, unknown>;
    legacy.version = 0;
    const nodes = legacy.nodes as Record<string, Record<string, unknown>>;
    const legacyTarget = nodes['node-target'];
    assert.ok(legacyTarget);
    const contract = legacyTarget.contract as Record<string, unknown>;
    contract.bitDepth = contract.outputBitDepth;
    delete contract.outputBitDepth;

    const migrated = parseProject(JSON.stringify(legacy));
    assert.equal(migrated.version, 4);
    const target = projectNode(migrated, 'node-target');
    assert.equal(target.type, 'target');
    if (target.type === 'target') {
      assert.equal(target.contract.outputBitDepth, 8);
    }
    const layer = projectNode(migrated, 'node-layer');
    assert.equal(layer.parameters.fill, 1);
    assert.equal(layer.type, 'layer');
    if (layer.type === 'layer') {
      assert.deepEqual(layer.effectIds, []);
      assert.equal(layer.visible, true);
      assert.equal(layer.locked, false);
    }
  });

  it('starts with an unresolved Composite and resolves color independently from source data', () => {
    const empty = createUntitledCompositeProject('Untitled', 'project-empty', 'node-composite');
    const target = projectNode(empty, 'node-composite');
    assert.equal(target.type, 'target');
    if (target.type !== 'target') return;
    assert.equal(target.contract.width, null);
    assert.equal(target.contract.height, null);
    assert.equal(target.contract.colorSpace, 'automatic');
    assert.equal(resolveTargetContract(empty, target), null);

    const imported = importedProject();
    const importedTarget = projectNode(imported, 'node-target');
    assert.equal(importedTarget.type, 'target');
    if (importedTarget.type !== 'target') return;
    assert.deepEqual(resolveTargetContract(imported, importedTarget), {
      ...importedTarget.contract,
      colorSpace: 'srgb',
      height: 600,
      width: 800,
    });
  });

  it('migrates layer visibility and lock defaults from version two', () => {
    const legacy = cloneProject(importedProject()) as unknown as Record<string, unknown>;
    legacy.version = 2;
    const nodes = legacy.nodes as Record<string, Record<string, unknown>>;
    const layer = nodes['node-layer'];
    assert.ok(layer);
    delete layer.visible;
    delete layer.locked;

    const migrated = parseProject(JSON.stringify(legacy));
    const migratedLayer = projectNode(migrated, 'node-layer');
    assert.equal(migratedLayer.type, 'layer');
    if (migratedLayer.type === 'layer') {
      assert.equal(migratedLayer.visible, true);
      assert.equal(migratedLayer.locked, false);
    }
  });

  it('distinguishes embedded, available linked, and missing linked assets', () => {
    const linked = createLinkedImageAsset({
      contentHash: HASH_B,
      fileName: 'linked.png',
      height: 20,
      id: 'asset-linked',
      lastModified: 123,
      mediaType: 'image/png',
      name: 'Linked',
      width: 30,
    });
    assert.equal(
      assetAvailability(embeddedAsset(), { availableContentHashes: new Set() }),
      'embedded',
    );
    assert.equal(
      assetAvailability(linked, { availableContentHashes: new Set([HASH_B]) }),
      'available',
    );
    assert.equal(assetAvailability(linked, { availableContentHashes: new Set() }), 'missing');
  });

  it('rejects unsupported target formats and invalid parameters with useful paths', () => {
    const project = cloneProject(importedProject());
    const target = projectNode(project, 'node-target');
    if (target.type === 'target') {
      target.contract.outputFormat = 'jpeg';
      target.contract.outputBitDepth = 16;
    }
    assert.throws(() => validateProject(project), /JPEG output currently requires 8-bit/);

    const opacity = createNode('process/opacity', 'node-opacity') as ProcessorNode;
    opacity.parameters.amount = 2;
    project.nodes[opacity.id] = opacity;
    assert.throws(() => validateProject(project), /parameters\.amount must be at most 1/);

    const invalidState = cloneProject(importedProject()) as unknown as Record<string, unknown>;
    const nodes = invalidState.nodes as Record<string, Record<string, unknown>>;
    const layer = nodes['node-layer'];
    assert.ok(layer);
    layer.visible = 'yes';
    assert.throws(() => validateProject(invalidState), /nodes\.node-layer\.visible/);
  });

  it('validates optional canvas background properties', () => {
    const project = cloneProject(importedProject());
    const target = projectNode(project, 'node-target');
    assert.equal(target.type, 'target');
    if (target.type !== 'target') return;
    target.background = {
      color: { a: 1, b: 0.25, g: 0.5, r: 0.75 },
      mode: 'custom',
      visible: true,
    };
    assert.doesNotThrow(() => validateProject(project));
    target.background.color = { a: 1, b: 0, g: 0, r: 2 };
    assert.throws(() => validateProject(project), /background\.color\.r/);
  });

  it('rejects duplicate ownership, incompatible wires, and dependency cycles', () => {
    const duplicate = cloneProject(importedProject());
    const opacity = createNode('process/opacity', 'node-opacity') as ProcessorNode;
    opacity.childId = 'node-source';
    duplicate.nodes[opacity.id] = opacity;
    assert.throws(() => validateProject(duplicate), /only one is allowed/);

    const incompatible = cloneProject(importedProject());
    incompatible.wires.push({
      from: { nodeId: 'node-source', port: 'image' },
      id: 'wire-incompatible',
      to: { nodeId: 'node-layer', port: 'mask' },
    });
    assert.throws(() => validateProject(incompatible), /incompatible image and mask ports/);

    const cycle = cloneProject(importedProject());
    const cyclic = createNode('process/opacity', 'node-cycle') as ProcessorNode;
    cyclic.childId = cyclic.id;
    cycle.nodes[cyclic.id] = cyclic;
    assert.throws(() => validateProject(cycle), /dependency cycle/);
  });

  it('reports malformed JSON and newer versions as project format errors', () => {
    assert.throws(() => parseProject('{'), ProjectValidationError);
    const malformedWire = JSON.parse(serializeProject(importedProject()));
    malformedWire.wires = [null];
    assert.throws(() => parseProject(JSON.stringify(malformedWire)), /wires\.0 must be an object/);
    const future = JSON.parse(serializeProject(importedProject()));
    future.version = 99;
    assert.throws(() => parseProject(JSON.stringify(future)), /newer than supported/);
  });
});
