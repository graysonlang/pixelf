import type { JsonValue, PortKind, ProjectNode } from './types.js';

export type ParameterKind = 'boolean' | 'enum' | 'number' | 'string';

export interface ParameterDefinition {
  default: JsonValue;
  description: string;
  integer?: boolean;
  key: string;
  kind: ParameterKind;
  label: string;
  maximum?: number;
  minimum?: number;
  values?: readonly string[];
}

export interface PortDefinition {
  direction: 'input' | 'output';
  key: string;
  kind: PortKind;
  label: string;
  multiple?: boolean;
}

export type PrimaryChildPolicy = 'layers' | 'none' | 'one';

export interface RegionBehavior {
  kind: 'halo' | 'identity' | 'source' | 'spatial';
  radiusParameter?: string;
}

export interface ExecutionBehavior {
  cpuRunner: 'reference';
  gpuRunner: 'cpu-upload' | 'direct';
  quality: 'exact' | 'scalable';
}

export interface NodeDefinition {
  childPolicy: PrimaryChildPolicy;
  description: string;
  execution?: ExecutionBehavior;
  kind: 'layer' | 'processor' | 'source' | 'target';
  parameters: readonly ParameterDefinition[];
  ports: readonly PortDefinition[];
  region: RegionBehavior;
  title: string;
  type: string;
}

function defineNode(definition: NodeDefinition): NodeDefinition {
  return Object.freeze({
    ...definition,
    parameters: Object.freeze([...definition.parameters]),
    ports: Object.freeze([...definition.ports]),
  });
}

const bypass: ParameterDefinition = {
  default: false,
  description: 'Pass the child image through without applying this operation.',
  key: 'bypass',
  kind: 'boolean',
  label: 'Bypass',
};

function numberParameter(
  key: string,
  label: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): ParameterDefinition {
  return {
    default: defaultValue,
    description: `${label} for this operation.`,
    key,
    kind: 'number',
    label,
    maximum,
    minimum,
  };
}

function processor(
  type: string,
  title: string,
  description: string,
  parameters: readonly ParameterDefinition[],
  region: RegionBehavior = { kind: 'identity' },
  quality: ExecutionBehavior['quality'] = 'exact',
): NodeDefinition {
  return defineNode({
    childPolicy: 'one',
    description,
    execution: { cpuRunner: 'reference', gpuRunner: 'cpu-upload', quality },
    kind: 'processor',
    parameters: [...parameters, bypass],
    ports: [{ direction: 'output', key: 'image', kind: 'image', label: 'Image' }],
    region,
    title,
    type,
  });
}

const definitions = [
  defineNode({
    childPolicy: 'layers',
    description: 'The destination image and its complete output contract.',
    kind: 'target',
    parameters: [],
    ports: [],
    region: { kind: 'identity' },
    title: 'Target',
    type: 'target',
  }),
  defineNode({
    childPolicy: 'one',
    description: 'An ordered image branch composited into a target.',
    kind: 'layer',
    parameters: [
      {
        default: 1,
        description: 'The layer contribution from transparent to fully visible.',
        key: 'opacity',
        kind: 'number',
        label: 'Opacity',
        maximum: 1,
        minimum: 0,
      },
      {
        default: 'normal',
        description: 'How the layer combines with the accumulated target.',
        key: 'blendMode',
        kind: 'enum',
        label: 'Blend mode',
        values: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'add'],
      },
    ],
    ports: [
      { direction: 'input', key: 'mask', kind: 'mask', label: 'Mask' },
      { direction: 'output', key: 'image', kind: 'image', label: 'Image' },
    ],
    region: { kind: 'identity' },
    title: 'Layer',
    type: 'layer',
  }),
  processor(
    'process/crop',
    'Crop',
    'Keeps pixels inside a reversible rectangular crop.',
    [
      numberParameter('x', 'X', 0, -100000, 100000),
      numberParameter('y', 'Y', 0, -100000, 100000),
      numberParameter('width', 'Width', 1024, 1, 100000),
      numberParameter('height', 'Height', 1024, 1, 100000),
    ],
    { kind: 'spatial' },
  ),
  processor(
    'process/canvas-resize',
    'Canvas resize',
    'Changes the visible canvas bounds without baking pixels.',
    [
      numberParameter('x', 'X', 0, -100000, 100000),
      numberParameter('y', 'Y', 0, -100000, 100000),
      numberParameter('width', 'Width', 1024, 1, 100000),
      numberParameter('height', 'Height', 1024, 1, 100000),
    ],
    { kind: 'spatial' },
  ),
  processor(
    'process/affine',
    'Transform',
    'Translates, scales, and rotates the image around a pivot.',
    [
      numberParameter('x', 'X', 0, -100000, 100000),
      numberParameter('y', 'Y', 0, -100000, 100000),
      numberParameter('scaleX', 'Scale X', 1, -1000, 1000),
      numberParameter('scaleY', 'Scale Y', 1, -1000, 1000),
      numberParameter('rotation', 'Rotation', 0, -36000, 36000),
      numberParameter('pivotX', 'Pivot X', 0, -100000, 100000),
      numberParameter('pivotY', 'Pivot Y', 0, -100000, 100000),
    ],
    { kind: 'spatial' },
    'scalable',
  ),
  processor(
    'process/opacity',
    'Opacity',
    'A reversible opacity adjustment in the primary image path.',
    [numberParameter('amount', 'Amount', 1, 0, 1)],
  ),
  processor('process/exposure', 'Exposure', 'Scales scene-linear light by photographic stops.', [
    numberParameter('stops', 'Stops', 0, -20, 20),
  ]),
  processor('process/levels', 'Levels', 'Remaps black, white, gamma, and output endpoints.', [
    numberParameter('inBlack', 'Input black', 0, 0, 1),
    numberParameter('inWhite', 'Input white', 1, 0, 1),
    numberParameter('gamma', 'Gamma', 1, 0.01, 100),
    numberParameter('outBlack', 'Output black', 0, 0, 1),
    numberParameter('outWhite', 'Output white', 1, 0, 1),
  ]),
  processor(
    'process/white-balance',
    'White balance',
    'Adjusts relative red, green, and blue response.',
    [
      numberParameter('temperature', 'Temperature', 0, -1, 1),
      numberParameter('tint', 'Tint', 0, -1, 1),
    ],
  ),
  processor('process/contrast', 'Contrast', 'Adjusts contrast around middle gray.', [
    numberParameter('amount', 'Amount', 0, -1, 10),
  ]),
  processor('process/saturation', 'Saturation', 'Adjusts colorfulness in linear working space.', [
    numberParameter('amount', 'Amount', 1, 0, 10),
  ]),
  processor(
    'process/channel',
    'Channel inspection',
    'Displays a selected color or alpha channel.',
    [
      {
        default: 'rgba',
        description: 'The channel shown as a grayscale inspection view.',
        key: 'channel',
        kind: 'enum',
        label: 'Channel',
        values: ['rgba', 'red', 'green', 'blue', 'alpha', 'luma'],
      },
    ],
  ),
  processor(
    'process/blur',
    'Blur',
    'Applies an alpha-safe Gaussian blur.',
    [numberParameter('sigma', 'Radius', 2, 0, 1000)],
    { kind: 'halo', radiusParameter: 'sigma' },
    'scalable',
  ),
  processor(
    'process/sharpen',
    'Sharpen',
    'Applies alpha-safe unsharp masking.',
    [
      numberParameter('radius', 'Radius', 1, 0, 1000),
      numberParameter('amount', 'Amount', 1, 0, 20),
    ],
    { kind: 'halo', radiusParameter: 'radius' },
    'scalable',
  ),
  defineNode({
    childPolicy: 'none',
    description: 'A decoded image asset used as a leaf in the primary image path.',
    kind: 'source',
    parameters: [],
    ports: [{ direction: 'output', key: 'image', kind: 'image', label: 'Image' }],
    region: { kind: 'source' },
    title: 'Imported image',
    type: 'source/imported',
  }),
  defineNode({
    childPolicy: 'none',
    description: 'A constant mask used to exercise secondary typed wiring.',
    kind: 'source',
    parameters: [
      {
        default: 1,
        description: 'The mask value from black to white.',
        key: 'value',
        kind: 'number',
        label: 'Value',
        maximum: 1,
        minimum: 0,
      },
      {
        default: false,
        description: 'Invert black and white mask contribution.',
        key: 'invert',
        kind: 'boolean',
        label: 'Invert',
      },
      numberParameter('density', 'Density', 1, 0, 1),
      numberParameter('feather', 'Feather', 0, 0, 1000),
      numberParameter('x', 'X', 0, -100000, 100000),
      numberParameter('y', 'Y', 0, -100000, 100000),
      numberParameter('scaleX', 'Scale X', 1, -1000, 1000),
      numberParameter('scaleY', 'Scale Y', 1, -1000, 1000),
      numberParameter('rotation', 'Rotation', 0, -36000, 36000),
    ],
    ports: [{ direction: 'output', key: 'mask', kind: 'mask', label: 'Mask' }],
    region: { kind: 'source' },
    title: 'Constant mask',
    type: 'source/mask',
  }),
] as const;

const definitionsByType = new Map(definitions.map(definition => [definition.type, definition]));

export class NodeRegistry {
  all(): readonly NodeDefinition[] {
    return definitions;
  }

  get(type: string): NodeDefinition | undefined {
    return definitionsByType.get(type);
  }

  require(type: string): NodeDefinition {
    const definition = this.get(type);
    if (definition === undefined) throw new Error(`Unsupported node type: ${type}`);
    return definition;
  }

  defaults(type: string): Record<string, JsonValue> {
    return Object.fromEntries(
      this.require(type).parameters.map(parameter => [parameter.key, parameter.default]),
    );
  }

  port(node: ProjectNode, key: string, direction: 'input' | 'output'): PortDefinition | undefined {
    return this.get(node.type)?.ports.find(
      candidate => candidate.key === key && candidate.direction === direction,
    );
  }
}

export const nodeRegistry = new NodeRegistry();
