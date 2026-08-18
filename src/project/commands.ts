import { cloneProject, createOpaqueId, findPrimaryParent } from './project.js';
import type {
  ImageAsset,
  JsonValue,
  PixelfProject,
  ProjectNode,
  ProjectWire,
  TargetContract,
} from './types.js';
import { validateProject } from './validation.js';

export type ProjectCommand =
  | { index?: number; node: ProjectNode; parentId: string | null; type: 'insert-node' }
  | { nodeId: string; type: 'remove-node' }
  | { index: number; nodeId: string; parentId: string | null; type: 'move-node' }
  | { key: string; nodeId: string; type: 'set-parameter'; value: JsonValue }
  | { contract: TargetContract; nodeId: string; type: 'set-target-contract' }
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
  const parent = findPrimaryParent(project, nodeId);
  if (parent === null) {
    const rootIndex = project.targetIds.indexOf(nodeId);
    if (rootIndex >= 0) project.targetIds.splice(rootIndex, 1);
    return;
  }
  if (parent.node.type === 'target') parent.node.childIds.splice(parent.index, 1);
  else parent.node.childId = null;
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
  if (parent.type === 'target') {
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
  if (node?.type === 'target')
    for (const childId of node.childIds) descendants(project, childId, found);
  else if (node && 'childId' in node && node.childId) {
    descendants(project, node.childId, found);
  }
  return found;
}

function applyMutable(project: PixelfProject, command: ProjectCommand): void {
  switch (command.type) {
    case 'insert-node': {
      if (project.nodes[command.node.id] !== undefined) {
        throw new Error(`Node ${command.node.id} already exists`);
      }
      project.nodes[command.node.id] = structuredClone(command.node);
      attachToParent(project, command.node.id, command.parentId, command.index);
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
    case 'set-parameter': {
      const node = project.nodes[command.nodeId];
      if (node === undefined) throw new Error(`Cannot edit missing node ${command.nodeId}`);
      node.parameters[command.key] = structuredClone(command.value);
      return;
    }
    case 'set-target-contract': {
      const node = project.nodes[command.nodeId];
      if (node?.type !== 'target') throw new Error(`${command.nodeId} is not a target`);
      node.contract = structuredClone(command.contract);
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
    if (copy.type === 'target') {
      copy.childIds = copy.childIds.map(childId => replacements.get(childId) ?? childId);
    } else if ('childId' in copy && copy.childId !== null) {
      copy.childId = replacements.get(copy.childId) ?? copy.childId;
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
