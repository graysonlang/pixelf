import { cloneProject, findPrimaryParent } from './project.js';
import type {
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
    case 'batch':
      for (const child of command.commands) applyMutable(project, child);
  }
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
