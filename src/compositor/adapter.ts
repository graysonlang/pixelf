import type { PixelfProject, ProjectNode, TargetNode } from '../project/types.js';
import { validateProject } from '../project/validation.js';
import { image, type Effect, type Graph, type ImageSource } from './graph.js';

export interface DecodedImageAsset {
  data: Float32Array;
  height: number;
  revision: string;
  width: number;
}

export interface DecodedAssetStore {
  get(assetId: string): DecodedImageAsset | undefined;
}

export interface ProjectGraph {
  graph: Graph;
  target: TargetNode;
  targetKey: string;
}

function targetCacheKey(target: TargetNode): string {
  const contract = target.contract;
  return [
    target.id,
    `${contract.width}x${contract.height}`,
    contract.channels,
    contract.workingFormat,
    contract.colorSpace,
    contract.outputFormat,
    contract.outputBitDepth,
    contract.alphaPolicy,
  ].join(':');
}

function requireNode(project: PixelfProject, nodeId: string): ProjectNode {
  const node = project.nodes[nodeId];
  if (node === undefined) throw new Error(`Missing projected node ${nodeId}`);
  return node;
}

function sourceForLayer(
  project: PixelfProject,
  root: ProjectNode,
  decodedAssets: DecodedAssetStore,
): { effects: Effect[]; opacity: number; source: ImageSource } {
  const effects: Effect[] = [];
  let opacity = 1;
  let node = root;
  const visited = new Set<string>();
  while (node.type.startsWith('process/')) {
    if (visited.has(node.id)) throw new Error(`Projection cycle includes ${node.id}`);
    visited.add(node.id);
    if (node.parameters.bypass !== true) {
      if (node.type === 'process/opacity') {
        const amount = node.parameters.amount;
        if (typeof amount !== 'number') throw new Error(`${node.id}.amount must be numeric`);
        opacity *= amount;
      } else {
        throw new Error(`No CPU projection exists for ${node.type}`);
      }
    }
    if (!('childId' in node) || node.childId === null) {
      throw new Error(`Processor ${node.id} has no source child`);
    }
    node = requireNode(project, node.childId);
  }
  if (node.type !== 'source/imported' || node.assetId === undefined) {
    throw new Error(`Layer source ${node.id} is not a decoded imported image`);
  }
  const asset = project.assets[node.assetId];
  if (asset === undefined) throw new Error(`Missing asset metadata ${node.assetId}`);
  const decoded = decodedAssets.get(node.assetId);
  if (decoded === undefined) throw new Error(`Image asset ${node.assetId} is unavailable`);
  if (decoded.width !== asset.width || decoded.height !== asset.height) {
    throw new Error(`Decoded dimensions for ${node.assetId} do not match its asset metadata`);
  }
  return {
    effects,
    opacity,
    source: image(decoded.width, decoded.height, decoded.data, decoded.revision),
  };
}

export function projectTargetToGraph(
  project: PixelfProject,
  targetId: string,
  decodedAssets: DecodedAssetStore,
): ProjectGraph {
  validateProject(project);
  const target = requireNode(project, targetId);
  if (target.type !== 'target') throw new Error(`${targetId} is not a target`);
  const entities = target.childIds.map(layerId => {
    const layer = requireNode(project, layerId);
    if (layer.type !== 'layer') throw new Error(`${layerId} is not a layer`);
    if (layer.childId === null) throw new Error(`Layer ${layerId} has no source child`);
    const source = sourceForLayer(project, requireNode(project, layer.childId), decodedAssets);
    const layerOpacity = layer.parameters.opacity;
    if (typeof layerOpacity !== 'number') throw new Error(`${layer.id}.opacity must be numeric`);
    return {
      blend: 'normal' as const,
      effects: source.effects,
      h: target.contract.height,
      id: layer.id,
      opacity: layerOpacity * source.opacity,
      source: source.source,
      w: target.contract.width,
      x: 0,
      y: 0,
    };
  });
  return { graph: { entities }, target, targetKey: targetCacheKey(target) };
}
