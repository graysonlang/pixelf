import {
  cloneProject,
  createOpaqueId,
  findLayerEffectOwner,
  findPrimaryParent,
} from './project.js';
import { nodeRegistry } from './registry.js';
import type {
  CanvasBackground,
  ContentLayerNode,
  FilterLayerNode,
  ImageAsset,
  JsonValue,
  LayerEffectNode,
  PixelfProject,
  ProjectNode,
  ProjectWire,
  TargetContract,
} from './types.js';
import { validateProject } from './validation.js';

export type ProjectCommand =
  | { asset: ImageAsset; type: 'insert-asset' }
  | { index?: number; node: ProjectNode; parentId: string | null; type: 'insert-node' }
  | { effect: LayerEffectNode; index?: number; ownerId: string; type: 'insert-layer-effect' }
  | { nodeId: string; type: 'remove-node' }
  | { index: number; nodeId: string; parentId: string | null; type: 'move-node' }
  | { name: string; type: 'set-project-name' }
  | { key: string; nodeId: string; type: 'set-parameter'; value: JsonValue }
  | { nodeId: string; type: 'set-stack-item-visibility'; visible: boolean }
  | { locked: boolean; nodeId: string; type: 'set-stack-item-lock' }
  | { filterType: string; nodeId: string; type: 'set-filter-type' }
  | { contentType: string; nodeId: string; type: 'set-content-type' }
  | { effectId: string; enabled: boolean; type: 'set-layer-effect-enabled' }
  | { contract: TargetContract; nodeId: string; type: 'set-target-contract' }
  | { background: CanvasBackground; nodeId: string; type: 'set-target-background' }
  | { type: 'connect'; wire: ProjectWire }
  | { type: 'disconnect'; wireId: string }
  | {
      asset: ImageAsset;
      mode: 'new-asset' | 'replace-asset';
      nodeId: string;
      sourceId: string;
      type: 'rasterize-node';
    }
  | { commands: readonly ProjectCommand[]; type: 'batch' };

function removeFromParent(project: PixelfProject, nodeId: string): void {
  const effectOwner = findLayerEffectOwner(project, nodeId);
  if (effectOwner !== null) {
    const index = effectOwner.effectIds.indexOf(nodeId);
    if (index >= 0) effectOwner.effectIds.splice(index, 1);
    return;
  }
  const parent = findPrimaryParent(project, nodeId);
  if (parent === null) {
    const rootIndex = project.targetIds.indexOf(nodeId);
    if (rootIndex >= 0) project.targetIds.splice(rootIndex, 1);
    return;
  }
  if (parent.node.type === 'target' || parent.node.type === 'group') {
    parent.node.childIds.splice(parent.index, 1);
  } else parent.node.childId = null;
}

function attachToParent(
  project: PixelfProject,
  nodeId: string,
  parentId: string | null,
  index = Number.POSITIVE_INFINITY,
): void {
  const node = project.nodes[nodeId];
  if (node === undefined) throw new Error(`Cannot attach missing node ${nodeId}`);
  if (parentId === null) {
    if (node.type !== 'target') return;
    project.targetIds.splice(Math.min(index, project.targetIds.length), 0, nodeId);
    return;
  }
  const parent = project.nodes[parentId];
  if (parent === undefined) throw new Error(`Cannot attach to missing parent ${parentId}`);
  if (parent.type === 'target' || parent.type === 'group') {
    parent.childIds.splice(Math.min(index, parent.childIds.length), 0, nodeId);
    return;
  }
  if ('childId' in parent) {
    if (parent.childId !== null) throw new Error(`Parent ${parentId} already has a primary child`);
    parent.childId = nodeId;
    return;
  }
  throw new Error(`Source node ${parentId} cannot own a primary child`);
}

function descendants(
  project: PixelfProject,
  nodeId: string,
  found = new Set<string>(),
): Set<string> {
  if (found.has(nodeId)) return found;
  found.add(nodeId);
  const node = project.nodes[nodeId];
  if (node?.type === 'target' || node?.type === 'group')
    for (const childId of node.childIds) descendants(project, childId, found);
  else if (node && 'childId' in node && node.childId) {
    descendants(project, node.childId, found);
  }
  if (node?.type === 'layer' || node?.type === 'group') {
    for (const effectId of node.effectIds) descendants(project, effectId, found);
  }
  return found;
}

function applyMutable(project: PixelfProject, command: ProjectCommand): void {
  switch (command.type) {
    case 'insert-asset': {
      if (project.assets[command.asset.id] !== undefined) {
        throw new Error(`Asset ${command.asset.id} already exists`);
      }
      project.assets[command.asset.id] = structuredClone(command.asset);
      return;
    }
    case 'insert-node': {
      if (project.nodes[command.node.id] !== undefined) {
        throw new Error(`Node ${command.node.id} already exists`);
      }
      project.nodes[command.node.id] = structuredClone(command.node);
      attachToParent(project, command.node.id, command.parentId, command.index);
      return;
    }
    case 'insert-layer-effect': {
      if (project.nodes[command.effect.id] !== undefined) {
        throw new Error(`Node ${command.effect.id} already exists`);
      }
      const owner = project.nodes[command.ownerId];
      if (owner?.type !== 'layer' && owner?.type !== 'group') {
        throw new Error(`Layer effect owner ${command.ownerId} is not a layer or group`);
      }
      project.nodes[command.effect.id] = structuredClone(command.effect);
      owner.effectIds.splice(
        Math.min(command.index ?? owner.effectIds.length, owner.effectIds.length),
        0,
        command.effect.id,
      );
      return;
    }
    case 'remove-node': {
      if (project.nodes[command.nodeId] === undefined) {
        throw new Error(`Cannot remove missing node ${command.nodeId}`);
      }
      removeFromParent(project, command.nodeId);
      const removed = descendants(project, command.nodeId);
      for (const nodeId of removed) delete project.nodes[nodeId];
      project.targetIds = project.targetIds.filter(nodeId => !removed.has(nodeId));
      project.wires = project.wires.filter(
        wire => !removed.has(wire.from.nodeId) && !removed.has(wire.to.nodeId),
      );
      return;
    }
    case 'move-node':
      removeFromParent(project, command.nodeId);
      attachToParent(project, command.nodeId, command.parentId, command.index);
      return;
    case 'set-project-name': {
      const name = command.name.trim();
      if (name.length === 0) throw new Error('A composite name cannot be empty');
      project.name = name;
      return;
    }
    case 'set-parameter': {
      const node = project.nodes[command.nodeId];
      if (node === undefined) throw new Error(`Cannot edit missing node ${command.nodeId}`);
      node.parameters[command.key] = structuredClone(command.value);
      return;
    }
    case 'set-stack-item-visibility': {
      const node = project.nodes[command.nodeId];
      if (
        node?.type !== 'layer' &&
        node?.type !== 'filter' &&
        node?.type !== 'content' &&
        node?.type !== 'group'
      ) {
        throw new Error(`Cannot change visibility for non-layer ${command.nodeId}`);
      }
      node.visible = command.visible;
      return;
    }
    case 'set-stack-item-lock': {
      const node = project.nodes[command.nodeId];
      if (
        node?.type !== 'layer' &&
        node?.type !== 'filter' &&
        node?.type !== 'content' &&
        node?.type !== 'group'
      ) {
        throw new Error(`Cannot change lock state for non-layer ${command.nodeId}`);
      }
      node.locked = command.locked;
      return;
    }
    case 'set-filter-type': {
      const node = project.nodes[command.nodeId];
      if (node?.type !== 'filter') {
        throw new Error(`Cannot change the type of non-filter ${command.nodeId}`);
      }
      const currentDefinition = nodeRegistry.require(node.filterType);
      const nextDefinition = nodeRegistry.require(command.filterType);
      if (
        currentDefinition.interchangeGroup !== 'filter' ||
        currentDefinition.interchangeGroup !== nextDefinition.interchangeGroup ||
        nextDefinition.kind !== 'processor'
      ) {
        throw new Error(`${command.filterType} cannot replace ${node.filterType}`);
      }
      const parameters = nodeRegistry.defaults(command.filterType);
      for (const key of Object.keys(parameters)) {
        const value = node.parameters[key];
        if (value !== undefined) parameters[key] = structuredClone(value);
      }
      if (node.name === currentDefinition.title) node.name = nextDefinition.title;
      node.filterType = command.filterType as FilterLayerNode['filterType'];
      node.parameters = parameters;
      return;
    }
    case 'set-content-type': {
      const node = project.nodes[command.nodeId];
      if (node?.type !== 'content') {
        throw new Error(`Cannot change the type of non-content ${command.nodeId}`);
      }
      const currentDefinition = nodeRegistry.require(node.contentType);
      const nextDefinition = nodeRegistry.require(command.contentType);
      if (
        currentDefinition.interchangeGroup !== 'content' ||
        currentDefinition.interchangeGroup !== nextDefinition.interchangeGroup ||
        nextDefinition.kind !== 'content'
      ) {
        throw new Error(`${command.contentType} cannot replace ${node.contentType}`);
      }
      const parameters = nodeRegistry.defaults(command.contentType);
      for (const key of Object.keys(parameters)) {
        const value = node.parameters[key];
        if (value !== undefined) parameters[key] = structuredClone(value);
      }
      if (node.name === currentDefinition.title || node.name === 'Content Layer') {
        node.name = nextDefinition.title;
      }
      node.contentType = command.contentType as ContentLayerNode['contentType'];
      node.parameters = parameters;
      return;
    }
    case 'set-layer-effect-enabled': {
      const node = project.nodes[command.effectId];
      if (node === undefined || !node.type.startsWith('effect/') || !('enabled' in node)) {
        throw new Error(`Cannot change enabled state for non-effect ${command.effectId}`);
      }
      node.enabled = command.enabled;
      return;
    }
    case 'set-target-contract': {
      const node = project.nodes[command.nodeId];
      if (node?.type !== 'target') throw new Error(`${command.nodeId} is not a target`);
      node.contract = structuredClone(command.contract);
      return;
    }
    case 'set-target-background': {
      const node = project.nodes[command.nodeId];
      if (node?.type !== 'target') throw new Error(`${command.nodeId} is not a target`);
      node.background = structuredClone(command.background);
      return;
    }
    case 'connect':
      project.wires.push(structuredClone(command.wire));
      return;
    case 'disconnect': {
      const index = project.wires.findIndex(wire => wire.id === command.wireId);
      if (index < 0) throw new Error(`Cannot disconnect missing wire ${command.wireId}`);
      project.wires.splice(index, 1);
      return;
    }
    case 'rasterize-node': {
      const node = project.nodes[command.nodeId];
      if (node === undefined) throw new Error(`Cannot rasterize missing node ${command.nodeId}`);
      if (command.mode === 'replace-asset') {
        if (node.type !== 'source/imported' || node.assetId === undefined) {
          throw new Error('Replacing an asset requires an imported source node');
        }
        if (command.asset.id !== node.assetId) {
          throw new Error('A replacement asset must retain the source asset ID');
        }
        project.assets[command.asset.id] = structuredClone(command.asset);
        return;
      }
      if (node.type === 'target' || node.type === 'layer') {
        throw new Error('Rasterize a layer child or operation, not its target or layer container');
      }
      if (project.nodes[command.sourceId] !== undefined) {
        throw new Error(`Node ${command.sourceId} already exists`);
      }
      const parent = findPrimaryParent(project, node.id);
      if (parent === null) throw new Error(`Rasterized node ${node.id} has no primary parent`);
      const parentId = parent.node.id;
      const index = parent.index;
      removeFromParent(project, node.id);
      const removed = descendants(project, node.id);
      for (const removedId of removed) delete project.nodes[removedId];
      project.wires = project.wires.filter(
        wire => !removed.has(wire.from.nodeId) && !removed.has(wire.to.nodeId),
      );
      project.assets[command.asset.id] = structuredClone(command.asset);
      project.nodes[command.sourceId] = {
        assetId: command.asset.id,
        id: command.sourceId,
        name: `${node.name} (rasterized)`,
        parameters: {},
        type: 'source/imported',
      };
      attachToParent(project, command.sourceId, parentId, index);
      return;
    }
    case 'batch':
      for (const child of command.commands) applyMutable(project, child);
  }
}

export function duplicateSubtreeCommand(project: PixelfProject, nodeId: string): ProjectCommand {
  const root = project.nodes[nodeId];
  if (root === undefined) throw new Error(`Cannot duplicate missing node ${nodeId}`);
  if (root.type === 'target') throw new Error('Duplicate target is not a branch operation');
  if (root.type.startsWith('effect/')) {
    const owner = findLayerEffectOwner(project, nodeId);
    if (owner === null) throw new Error(`Cannot duplicate detached layer effect ${nodeId}`);
    const copy = structuredClone(root) as LayerEffectNode;
    copy.id = createOpaqueId('node');
    copy.name = `${copy.name} copy`;
    return {
      effect: copy,
      index: owner.effectIds.indexOf(nodeId) + 1,
      ownerId: owner.id,
      type: 'insert-layer-effect',
    };
  }
  const parent = findPrimaryParent(project, nodeId);
  if (parent === null) throw new Error(`Cannot duplicate detached node ${nodeId}`);
  const copiedIds = descendants(project, nodeId);
  const replacements = new Map<string, string>();
  for (const copiedId of copiedIds) replacements.set(copiedId, createOpaqueId('node'));
  const commands: ProjectCommand[] = [];
  for (const copiedId of copiedIds) {
    const source = project.nodes[copiedId];
    const replacementId = replacements.get(copiedId);
    if (source === undefined || replacementId === undefined) continue;
    const copy = structuredClone(source);
    copy.id = replacementId;
    copy.name = copiedId === nodeId ? `${copy.name} copy` : copy.name;
    if (copy.type === 'target' || copy.type === 'group') {
      copy.childIds = copy.childIds.map(childId => replacements.get(childId) ?? childId);
    } else if ('childId' in copy && copy.childId !== null) {
      copy.childId = replacements.get(copy.childId) ?? copy.childId;
    }
    if (copy.type === 'layer' || copy.type === 'group') {
      copy.effectIds = copy.effectIds.map(effectId => replacements.get(effectId) ?? effectId);
    }
    commands.push({ node: copy, parentId: null, type: 'insert-node' });
  }
  for (const wire of project.wires) {
    const toId = replacements.get(wire.to.nodeId);
    if (toId === undefined) continue;
    commands.push({
      type: 'connect',
      wire: {
        from: { ...wire.from, nodeId: replacements.get(wire.from.nodeId) ?? wire.from.nodeId },
        id: createOpaqueId('wire'),
        to: { ...wire.to, nodeId: toId },
      },
    });
  }
  const newRootId = replacements.get(nodeId);
  if (newRootId === undefined) throw new Error(`Cannot duplicate ${nodeId}`);
  commands.push({
    index: parent.index + 1,
    nodeId: newRootId,
    parentId: parent.node.id,
    type: 'move-node',
  });
  return { commands, type: 'batch' };
}

export function applyProjectCommand(
  project: PixelfProject,
  command: ProjectCommand,
): PixelfProject {
  const next = cloneProject(project);
  applyMutable(next, command);
  validateProject(next);
  return next;
}
