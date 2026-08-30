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

function layerStackChildren(project: PixelfProject, node: ProjectNode): readonly string[] {
  if (node.type === 'target') return [];
  return primaryChildren(node).filter(
    childId => project.nodes[childId]?.type !== 'source/imported',
  );
}

function importedSourceForLayer(
  project: PixelfProject,
  layer: ProjectNode & { type: 'layer' },
): ProjectNode | undefined {
  const visited = new Set<string>();
  let childId = layer.childId;
  while (childId !== null && !visited.has(childId)) {
    visited.add(childId);
    const child = project.nodes[childId];
    if (child?.type === 'source/imported') return child;
    if (child === undefined || !('childId' in child)) return undefined;
    childId = child.childId;
  }
  return undefined;
}

export function pixelfNodeSummary(project: PixelfProject, node: ProjectNode): string {
  if (node.type === 'target') {
    return `Composite / ${node.contract.width} x ${node.contract.height} / ${node.contract.outputFormat} ${node.contract.outputBitDepth}-bit`;
  }
  if (node.type === 'filter') {
    return nodeRegistry.get(node.filterType)?.title ?? node.filterType;
  }
  const importedSource = node.type === 'layer' ? importedSourceForLayer(project, node) : node;
  if (importedSource?.type === 'source/imported' && importedSource.assetId !== undefined) {
    const asset = project.assets[importedSource.assetId];
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
  const children = layerStack ? layerStackChildren(snapshot.project, node) : primaryChildren(node);
  return {
    acceptsVisualDepth:
      node.type === 'filter' || node.type === 'layer' || node.type.startsWith('process/'),
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
      return node === undefined ? [] : layerStackChildren(snapshot.project, node);
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
