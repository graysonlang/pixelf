import { nodeRegistry } from '../project/registry.js';
import type { PixelfProject, ProcessorNode, ProjectNode, TargetNode } from '../project/types.js';
import { validateProject } from '../project/validation.js';
import {
  checker,
  graphHash,
  image,
  solid,
  type BlendMode,
  type Effect,
  type Entity,
  type EntityMask,
  type Graph,
  type GraphFilter,
  type ImageSource,
} from './graph.js';
import { renderRegion } from './render.js';

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

function operationEffect(node: ProjectNode, operationType: string, target: TargetNode): Effect {
  nodeRegistry.require(operationType);
  switch (operationType) {
    case 'process/opacity':
    case 'process/adjustment-group':
      return { amount: numberParameter(node, 'amount'), kind: 'opacity' };
    case 'process/composite':
      throw new Error('Composite effects require a secondary input projection');
    case 'process/crop':
    case 'process/canvas-resize':
      return {
        height: numberParameter(node, 'height'),
        kind: operationType === 'process/crop' ? 'crop' : 'canvas-resize',
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
    case 'process/brightness':
      return { amount: numberParameter(node, 'amount') / 100, kind: 'brightness' };
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
    case 'process/highlights':
    case 'process/shadows':
    case 'process/whites':
    case 'process/blacks':
      return {
        amount: numberParameter(node, 'amount') / 100,
        kind: operationType.slice('process/'.length) as
          | 'blacks'
          | 'highlights'
          | 'shadows'
          | 'whites',
      };
    case 'process/clarity':
      return {
        amount: numberParameter(node, 'amount') / 100,
        kind: 'clarity',
        radius: 4,
      };
    case 'process/vibrance':
      return { amount: numberParameter(node, 'amount') / 100, kind: 'vibrance' };
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
    case 'process/noise-reduction': {
      const amount = numberParameter(node, 'amount') / 100;
      return { amount, kind: 'noise-reduction', radius: amount * 4 };
    }
    case 'process/vignette':
      return {
        amount: numberParameter(node, 'amount') / 100,
        height: target.contract.height,
        kind: 'vignette',
        width: target.contract.width,
      };
    case 'process/grain':
      return {
        amount: numberParameter(node, 'amount') / 100,
        kind: 'grain',
        seed: numberParameter(node, 'seed'),
      };
    default:
      throw new Error(`No CPU projection exists for ${operationType}`);
  }
}

function sourceForLayer(
  project: PixelfProject,
  root: ProjectNode,
  decodedAssets: DecodedAssetStore,
  target: TargetNode,
  visited = new Set<string>(),
): { effects: Effect[]; source: ImageSource } {
  const effects: Effect[] = [];
  let node = root;
  while (node.type.startsWith('process/')) {
    if (visited.has(node.id)) throw new Error(`Projection cycle includes ${node.id}`);
    visited.add(node.id);
    if (node.parameters.bypass !== true) {
      if (node.type === 'process/composite') {
        const wire = project.wires.find(
          candidate => candidate.to.nodeId === node.id && candidate.to.port === 'secondary',
        );
        if (wire === undefined) throw new Error(`Composite ${node.id} has no secondary image`);
        const secondary = sourceForLayer(
          project,
          requireNode(project, wire.from.nodeId),
          decodedAssets,
          target,
          new Set(visited),
        );
        const mask = maskForNode(project, node.id, target);
        const effect: Effect = {
          blend: stringParameter(node, 'blendMode') as BlendMode,
          height: target.contract.height,
          kind: 'composite',
          opacity: numberParameter(node, 'opacity'),
          source: flattenBranch(secondary, target),
          width: target.contract.width,
        };
        effects.unshift(mask === undefined ? effect : { ...effect, mask });
      } else {
        const effect = operationEffect(node as ProcessorNode, node.type, target);
        const mask = maskForNode(project, node.id, target);
        effects.unshift(mask === undefined ? effect : { ...effect, mask });
      }
    }
    if (!('childId' in node) || node.childId === null) {
      throw new Error(`Processor ${node.id} has no source child`);
    }
    node = requireNode(project, node.childId);
  }
  if (node.type === 'source/shared') {
    if (visited.has(node.id)) throw new Error(`Projection cycle includes ${node.id}`);
    visited.add(node.id);
    const wire = project.wires.find(
      candidate => candidate.to.nodeId === node.id && candidate.to.port === 'input',
    );
    if (wire === undefined) throw new Error(`Shared image ${node.id} has no image input`);
    const shared = sourceForLayer(
      project,
      requireNode(project, wire.from.nodeId),
      decodedAssets,
      target,
      visited,
    );
    return {
      effects: [...shared.effects, ...effects],
      source: shared.source,
    };
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
    source: image(decoded.width, decoded.height, decoded.data, decoded.revision),
  };
}

function flattenBranch(
  branch: { effects: Effect[]; source: ImageSource },
  target: TargetNode,
): ImageSource {
  const graph: Graph = {
    entities: [
      {
        blend: 'normal',
        effects: branch.effects,
        fill: 1,
        h: target.contract.height,
        id: 'shared-secondary',
        opacity: 1,
        source: branch.source,
        w: target.contract.width,
        x: 0,
        y: 0,
      },
    ],
  };
  const surface = renderRegion(
    graph,
    { h: target.contract.height, w: target.contract.width, x: 0, y: 0 },
    1,
  );
  const straight = new Float32Array(surface.data.length);
  for (let offset = 0; offset < straight.length; offset += 4) {
    const alpha = surface.data[offset + 3] ?? 0;
    straight[offset] = alpha > 0 ? (surface.data[offset] ?? 0) / alpha : 0;
    straight[offset + 1] = alpha > 0 ? (surface.data[offset + 1] ?? 0) / alpha : 0;
    straight[offset + 2] = alpha > 0 ? (surface.data[offset + 2] ?? 0) / alpha : 0;
    straight[offset + 3] = alpha;
  }
  return image(target.contract.width, target.contract.height, straight, graphHash(graph));
}

function maskForNode(
  project: PixelfProject,
  nodeId: string,
  target: TargetNode,
): EntityMask | undefined {
  const wire = project.wires.find(
    candidate => candidate.to.nodeId === nodeId && candidate.to.port === 'mask',
  );
  if (wire === undefined) return undefined;
  const node = requireNode(project, wire.from.nodeId);
  if (node.type !== 'source/mask' && node.type !== 'source/checker-mask') {
    throw new Error(`${node.id} is not a supported mask source`);
  }
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
    source:
      node.type === 'source/mask'
        ? solid(
            numberParameter(node, 'value'),
            numberParameter(node, 'value'),
            numberParameter(node, 'value'),
          )
        : checker(
            numberParameter(node, 'size'),
            numberParameter(node, 'first'),
            numberParameter(node, 'second'),
            numberParameter(node, 'offsetX'),
            numberParameter(node, 'offsetY'),
          ),
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
  const entities: Entity[] = [];
  const filters: GraphFilter[] = [];
  for (const stackItemId of target.childIds) {
    const layer = requireNode(project, stackItemId);
    if (layer.type === 'filter') {
      if (layer.parameters.bypass !== true) {
        const effect = operationEffect(layer, layer.filterType, target);
        const mask = maskForNode(project, layer.id, target);
        filters.push({
          effect: mask === undefined ? effect : { ...effect, mask },
          id: layer.id,
          position: entities.length,
        });
      }
      continue;
    }
    if (layer.type !== 'layer') throw new Error(`${stackItemId} is not a stack item`);
    if (layer.childId === null) throw new Error(`Layer ${layer.id} has no source child`);
    const source = sourceForLayer(
      project,
      requireNode(project, layer.childId),
      decodedAssets,
      target,
    );
    const layerOpacity = layer.parameters.opacity;
    if (typeof layerOpacity !== 'number') throw new Error(`${layer.id}.opacity must be numeric`);
    const blendMode = layer.parameters.blendMode;
    if (typeof blendMode !== 'string') throw new Error(`${layer.id}.blendMode must be text`);
    const layerFill = layer.parameters.fill;
    if (typeof layerFill !== 'number') throw new Error(`${layer.id}.fill must be numeric`);
    entities.push({
      blend: blendMode as BlendMode,
      effects: source.effects,
      fill: layerFill,
      h: target.contract.height,
      id: layer.id,
      opacity: layerOpacity,
      mask: maskForNode(project, layer.id, target),
      source: source.source,
      w: target.contract.width,
      x: 0,
      y: 0,
    });
  }
  return {
    graph: { entities, filters: filters.length > 0 ? filters : undefined },
    target,
    targetKey: targetCacheKey(target),
  };
}
