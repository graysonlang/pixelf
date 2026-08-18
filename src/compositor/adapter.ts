import { nodeRegistry } from '../project/registry.js';
import type { PixelfProject, ProcessorNode, ProjectNode, TargetNode } from '../project/types.js';
import { validateProject } from '../project/validation.js';
import {
  image,
  solid,
  type BlendMode,
  type Effect,
  type EntityMask,
  type Graph,
  type ImageSource,
} from './graph.js';

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

function numberParameter(node: ProjectNode, key: string): number {
  const value = node.parameters[key];
  if (typeof value !== 'number') throw new Error(`${node.id}.${key} must be numeric`);
  return value;
}

function stringParameter(node: ProjectNode, key: string): string {
  const value = node.parameters[key];
  if (typeof value !== 'string') throw new Error(`${node.id}.${key} must be text`);
  return value;
}

function operationEffect(node: ProcessorNode): Effect | null {
  nodeRegistry.require(node.type);
  switch (node.type) {
    case 'process/opacity':
      return null;
    case 'process/crop':
    case 'process/canvas-resize':
      return {
        height: numberParameter(node, 'height'),
        kind: node.type === 'process/crop' ? 'crop' : 'canvas-resize',
        width: numberParameter(node, 'width'),
        x: numberParameter(node, 'x'),
        y: numberParameter(node, 'y'),
      };
    case 'process/affine':
      return {
        kind: 'affine',
        pivotX: numberParameter(node, 'pivotX'),
        pivotY: numberParameter(node, 'pivotY'),
        rotation: numberParameter(node, 'rotation'),
        scaleX: numberParameter(node, 'scaleX'),
        scaleY: numberParameter(node, 'scaleY'),
        x: numberParameter(node, 'x'),
        y: numberParameter(node, 'y'),
      };
    case 'process/exposure':
      return { kind: 'exposure', stops: numberParameter(node, 'stops') };
    case 'process/levels':
      return {
        gamma: numberParameter(node, 'gamma'),
        inBlack: numberParameter(node, 'inBlack'),
        inWhite: numberParameter(node, 'inWhite'),
        kind: 'levels',
        outBlack: numberParameter(node, 'outBlack'),
        outWhite: numberParameter(node, 'outWhite'),
      };
    case 'process/white-balance':
      return {
        kind: 'white-balance',
        temperature: numberParameter(node, 'temperature'),
        tint: numberParameter(node, 'tint'),
      };
    case 'process/contrast':
      return { amount: numberParameter(node, 'amount'), kind: 'contrast' };
    case 'process/saturation':
      return { amount: numberParameter(node, 'amount'), kind: 'saturation' };
    case 'process/channel': {
      const channel = stringParameter(node, 'channel');
      if (!['alpha', 'blue', 'green', 'luma', 'red', 'rgba'].includes(channel)) {
        throw new Error(`${node.id}.channel is unsupported`);
      }
      return {
        channel: channel as Extract<Effect, { kind: 'channel' }>['channel'],
        kind: 'channel',
      };
    }
    case 'process/blur':
      return { kind: 'blur', sigma: numberParameter(node, 'sigma') };
    case 'process/sharpen':
      return {
        amount: numberParameter(node, 'amount'),
        kind: 'sharpen',
        radius: numberParameter(node, 'radius'),
      };
    default:
      throw new Error(`No CPU projection exists for ${node.type}`);
  }
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
      const effect = operationEffect(node as ProcessorNode);
      if (effect === null) opacity *= numberParameter(node, 'amount');
      else effects.unshift(effect);
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

function layerMask(
  project: PixelfProject,
  layerId: string,
  target: TargetNode,
): EntityMask | undefined {
  const wire = project.wires.find(
    candidate => candidate.to.nodeId === layerId && candidate.to.port === 'mask',
  );
  if (wire === undefined) return undefined;
  const node = requireNode(project, wire.from.nodeId);
  if (node.type !== 'source/mask') throw new Error(`${node.id} is not a supported mask source`);
  const value = numberParameter(node, 'value');
  const rotation = (numberParameter(node, 'rotation') * Math.PI) / 180;
  const scaleX = numberParameter(node, 'scaleX');
  const scaleY = numberParameter(node, 'scaleY');
  const feather = numberParameter(node, 'feather');
  return {
    density: numberParameter(node, 'density'),
    effects: feather > 0 ? [{ kind: 'blur', sigma: feather }] : [],
    h: target.contract.height,
    invert: node.parameters.invert === true,
    matrix: [
      Math.cos(rotation) * scaleX,
      Math.sin(rotation) * scaleX,
      -Math.sin(rotation) * scaleY,
      Math.cos(rotation) * scaleY,
      numberParameter(node, 'x'),
      numberParameter(node, 'y'),
    ],
    source: solid(value, value, value),
    w: target.contract.width,
    x: 0,
    y: 0,
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
    const blendMode = layer.parameters.blendMode;
    if (typeof blendMode !== 'string') throw new Error(`${layer.id}.blendMode must be text`);
    return {
      blend: blendMode as BlendMode,
      effects: source.effects,
      h: target.contract.height,
      id: layer.id,
      opacity: layerOpacity * source.opacity,
      mask: layerMask(project, layer.id, target),
      source: source.source,
      w: target.contract.width,
      x: 0,
      y: 0,
    };
  });
  return { graph: { entities }, target, targetKey: targetCacheKey(target) };
}
