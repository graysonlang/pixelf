import { findPrimaryParent } from '../../../project/project.js';
import { nodeRegistry } from '../../../project/registry.js';
import type { PixelfProject, ProjectNode } from '../../../project/types.js';
import type { Row, StructureAdapter } from '../model.js';

export interface PixelfStructureSnapshot {
  expanded: ReadonlySet<string>;
  project: PixelfProject;
  revision: string;
}

function primaryChildren(node: ProjectNode): readonly string[] {
  if (node.type === 'target') return node.childIds;
  if ('childId' in node && node.childId !== null) return [node.childId];
  return [];
}

export function pixelfNodeSummary(project: PixelfProject, node: ProjectNode): string {
  if (node.type === 'target') {
    return `Composite / ${node.contract.width} x ${node.contract.height} / ${node.contract.outputFormat} ${node.contract.outputBitDepth}-bit`;
  }
  if (node.type === 'source/imported' && node.assetId !== undefined) {
    const asset = project.assets[node.assetId];
    if (asset === undefined) return 'Missing asset';
    return `${asset.width} x ${asset.height} / ${asset.storage}`;
  }
  return nodeRegistry.get(node.type)?.title ?? node.type;
}

function describe(
  snapshot: PixelfStructureSnapshot,
  id: string,
  layerStack = false,
): Omit<Row, 'depth' | 'documentIndex' | 'height'> {
  const node = snapshot.project.nodes[id];
  if (node === undefined) throw new Error(`Cannot describe missing Pixelf node ${id}`);
  const parent = findPrimaryParent(snapshot.project, id);
  const isStackLayer = layerStack && parent?.node.type === 'target';
  const children = layerStack && node.type === 'target' ? [] : primaryChildren(node);
  return {
    acceptsVisualDepth: node.type === 'layer' || node.type.startsWith('process/'),
    expanded: snapshot.expanded.has(id),
    hasChildren: children.length > 0,
    kind: node.type,
    name: layerStack && node.type === 'target' ? snapshot.project.name : node.name,
    nodeId: node.id,
    parentId: isStackLayer ? null : (parent?.node.id ?? null),
    relation:
      node.type === 'target' || isStackLayer
        ? 'root'
        : parent?.node.type === 'target'
          ? 'ordered-child'
          : 'unary-child',
    selectable: true,
  };
}

export function createPixelfStructureAdapter(
  childOrder: StructureAdapter<PixelfStructureSnapshot>['childOrder'] = 'document',
): StructureAdapter<PixelfStructureSnapshot> {
  return {
    childOrder,
    childrenOf: (snapshot, id) => {
      const node = snapshot.project.nodes[id];
      return node === undefined ? [] : primaryChildren(node);
    },
    describe,
    revisionOf: snapshot => snapshot.revision,
    rootsOf: snapshot => snapshot.project.targetIds,
  };
}

export function createPixelfLayerStackAdapter(): StructureAdapter<PixelfStructureSnapshot> {
  return {
    childOrder: 'document',
    childrenOf: (snapshot, id) => {
      const node = snapshot.project.nodes[id];
      if (node === undefined || node.type === 'target') return [];
      return primaryChildren(node);
    },
    describe: (snapshot, id) => describe(snapshot, id, true),
    revisionOf: snapshot => snapshot.revision,
    rootsOf: snapshot => {
      const roots: string[] = [];
      for (const targetId of snapshot.project.targetIds) {
        const target = snapshot.project.nodes[targetId];
        if (target?.type !== 'target') continue;
        roots.push(...target.childIds.toReversed(), targetId);
      }
      return roots;
    },
  };
}
