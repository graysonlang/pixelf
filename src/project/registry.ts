import { BLEND_MODES } from '../image/blend-modes.js';
import type { JsonValue, PortKind, ProjectNode } from './types.js';

export type ParameterKind = 'boolean' | 'enum' | 'number' | 'string';

export interface ParameterDefinition {
  default: JsonValue;
  description?: string;
  integer?: boolean;
  key: string;
  kind: ParameterKind;
  label: string;
  maximum?: number;
  minimum?: number;
  presentation?: 'color' | 'percentage';
  scrubStep?: number;
  values?: readonly string[];
}

export interface PortDefinition {
  direction: 'input' | 'output';
  key: string;
  kind: PortKind;
  label: string;
  multiple?: boolean;
}

export type PrimaryChildPolicy = 'layers' | 'none' | 'one' | 'stack';

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
  interchangeGroup?: string;
  kind: 'content' | 'filter' | 'group' | 'layer' | 'processor' | 'source' | 'target';
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
  scrubStep?: number,
): ParameterDefinition {
  return {
    default: defaultValue,
    key,
    kind: 'number',
    label,
    maximum,
    minimum,
    scrubStep,
  };
}

function processor(
  type: string,
  title: string,
  description: string,
  parameters: readonly ParameterDefinition[],
  region: RegionBehavior = { kind: 'identity' },
  quality: ExecutionBehavior['quality'] = 'exact',
  inputs: readonly PortDefinition[] = [],
  interchangeGroup?: string,
): NodeDefinition {
  return defineNode({
    childPolicy: 'one',
    description,
    execution: { cpuRunner: 'reference', gpuRunner: 'cpu-upload', quality },
    interchangeGroup,
    kind: 'processor',
    parameters: [...parameters, bypass],
    ports: [
      { direction: 'input', key: 'mask', kind: 'mask', label: 'Mask' },
      ...inputs,
      { direction: 'output', key: 'image', kind: 'image', label: 'Image' },
    ],
    region,
    title,
    type,
  });
}

function filterProcessor(
  type: string,
  title: string,
  description: string,
  parameters: readonly ParameterDefinition[],
  region: RegionBehavior = { kind: 'identity' },
  quality: ExecutionBehavior['quality'] = 'exact',
): NodeDefinition {
  return processor(type, title, description, parameters, region, quality, [], 'filter');
}

const contentOpacity: ParameterDefinition = {
  default: 1,
  key: 'opacity',
  kind: 'number',
  label: 'Opacity',
  maximum: 1,
  minimum: 0,
  presentation: 'percentage',
};

const contentBlendMode: ParameterDefinition = {
  default: 'normal',
  key: 'blendMode',
  kind: 'enum',
  label: 'Blend mode',
  values: BLEND_MODES,
};

function colorParameter(key: string, label: string, defaultValue: string): ParameterDefinition {
  return {
    default: defaultValue,
    key,
    kind: 'string',
    label,
    presentation: 'color',
  };
}

function contentGenerator(
  type: string,
  title: string,
  description: string,
  parameters: readonly ParameterDefinition[],
): NodeDefinition {
  return defineNode({
    childPolicy: 'none',
    description,
    interchangeGroup: 'content',
    kind: 'content',
    parameters: [...parameters, contentOpacity, contentBlendMode],
    ports: [
      { direction: 'input', key: 'mask', kind: 'mask', label: 'Mask' },
      { direction: 'output', key: 'image', kind: 'image', label: 'Image' },
    ],
    region: { kind: 'source' },
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
        key: 'opacity',
        kind: 'number',
        label: 'Opacity',
        maximum: 1,
        minimum: 0,
        presentation: 'percentage',
      },
      {
        default: 1,
        key: 'fill',
        kind: 'number',
        label: 'Fill',
        maximum: 1,
        minimum: 0,
        presentation: 'percentage',
      },
      {
        default: 'normal',
        key: 'blendMode',
        kind: 'enum',
        label: 'Blend mode',
        values: BLEND_MODES,
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
  defineNode({
    childPolicy: 'none',
    description: 'A switchable filter applied to the accumulated stack beneath it.',
    kind: 'filter',
    parameters: [],
    ports: [{ direction: 'input', key: 'mask', kind: 'mask', label: 'Mask' }],
    region: { kind: 'identity' },
    title: 'Filter Layer',
    type: 'filter',
  }),
  defineNode({
    childPolicy: 'stack',
    description: 'An ordered compositing scope for layers, filters, and nested groups.',
    kind: 'group',
    parameters: [
      {
        default: 1,
        key: 'opacity',
        kind: 'number',
        label: 'Opacity',
        maximum: 1,
        minimum: 0,
        presentation: 'percentage',
      },
      {
        default: 'pass-through',
        key: 'compositing',
        kind: 'enum',
        label: 'Compositing',
        values: ['pass-through', 'isolated'],
      },
      {
        default: 'normal',
        key: 'blendMode',
        kind: 'enum',
        label: 'Blend mode',
        values: BLEND_MODES,
      },
    ],
    ports: [
      { direction: 'input', key: 'mask', kind: 'mask', label: 'Mask' },
      { direction: 'output', key: 'image', kind: 'image', label: 'Image' },
    ],
    region: { kind: 'identity' },
    title: 'Group',
    type: 'group',
  }),
  defineNode({
    childPolicy: 'none',
    description: 'A switchable procedural image generator in the layer stack.',
    kind: 'content',
    parameters: [],
    ports: [
      { direction: 'input', key: 'mask', kind: 'mask', label: 'Mask' },
      { direction: 'output', key: 'image', kind: 'image', label: 'Image' },
    ],
    region: { kind: 'source' },
    title: 'Content Layer',
    type: 'content',
  }),
  contentGenerator('content/solid', 'Solid fill', 'Generates a uniform color.', [
    colorParameter('color', 'Color', '#000000'),
  ]),
  contentGenerator(
    'content/gradient',
    'Linear gradient',
    'Generates a two-color linear gradient.',
    [
      colorParameter('startColor', 'Start color', '#000000'),
      colorParameter('endColor', 'End color', '#ffffff'),
      numberParameter('startX', 'Start X', 0, -10, 10, 0.01),
      numberParameter('startY', 'Start Y', 0.5, -10, 10, 0.01),
      numberParameter('endX', 'End X', 1, -10, 10, 0.01),
      numberParameter('endY', 'End Y', 0.5, -10, 10, 0.01),
    ],
  ),
  contentGenerator('content/pattern', 'Checker pattern', 'Generates a repeating checker pattern.', [
    colorParameter('firstColor', 'First color', '#000000'),
    colorParameter('secondColor', 'Second color', '#ffffff'),
    numberParameter('size', 'Cell size', 32, 1, 100000),
    numberParameter('offsetX', 'Offset X', 0, -100000, 100000),
    numberParameter('offsetY', 'Offset Y', 0, -100000, 100000),
  ]),
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
      numberParameter('scaleX', 'Scale X', 1, -1000, 1000, 0.01),
      numberParameter('scaleY', 'Scale Y', 1, -1000, 1000, 0.01),
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
  filterProcessor(
    'process/exposure',
    'Exposure',
    'Scales scene-linear light by photographic stops.',
    [numberParameter('stops', 'Stops', 0, -20, 20)],
  ),
  filterProcessor('process/brightness', 'Brightness', 'Scales overall image brightness.', [
    numberParameter('amount', 'Amount', 0, -100, 100),
  ]),
  filterProcessor('process/levels', 'Levels', 'Remaps black, white, gamma, and output endpoints.', [
    numberParameter('inBlack', 'Input black', 0, 0, 1),
    numberParameter('inWhite', 'Input white', 1, 0, 1),
    numberParameter('gamma', 'Gamma', 1, 0.01, 100, 0.01),
    numberParameter('outBlack', 'Output black', 0, 0, 1),
    numberParameter('outWhite', 'Output white', 1, 0, 1),
  ]),
  filterProcessor(
    'process/white-balance',
    'White balance',
    'Adjusts relative red, green, and blue response.',
    [
      numberParameter('temperature', 'Temperature', 0, -1, 1),
      numberParameter('tint', 'Tint', 0, -1, 1),
    ],
  ),
  filterProcessor('process/contrast', 'Contrast', 'Adjusts contrast around middle gray.', [
    numberParameter('amount', 'Amount', 0, -1, 10),
  ]),
  filterProcessor(
    'process/highlights',
    'Highlights',
    'Adjusts the brighter half of the tonal range.',
    [numberParameter('amount', 'Amount', 0, -100, 100)],
  ),
  filterProcessor('process/shadows', 'Shadows', 'Adjusts the darker half of the tonal range.', [
    numberParameter('amount', 'Amount', 0, -100, 100),
  ]),
  filterProcessor('process/whites', 'Whites', 'Adjusts the white range and diffuse highlights.', [
    numberParameter('amount', 'Amount', 0, -100, 100),
  ]),
  filterProcessor('process/blacks', 'Blacks', 'Adjusts the black range and shadow floor.', [
    numberParameter('amount', 'Amount', 0, -100, 100),
  ]),
  filterProcessor(
    'process/clarity',
    'Clarity',
    'Adjusts local midtone contrast with a tile-aware halo.',
    [numberParameter('amount', 'Amount', 0, -100, 100)],
    { kind: 'halo' },
    'scalable',
  ),
  filterProcessor('process/vibrance', 'Vibrance', 'Adjusts less colorful pixels preferentially.', [
    numberParameter('amount', 'Amount', 0, -100, 100),
  ]),
  filterProcessor(
    'process/saturation',
    'Saturation',
    'Adjusts colorfulness in linear working space.',
    [numberParameter('amount', 'Amount', 1, 0, 10)],
  ),
  filterProcessor(
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
  filterProcessor(
    'process/blur',
    'Blur',
    'Applies an alpha-safe Gaussian blur.',
    [numberParameter('sigma', 'Radius', 2, 0, 1000)],
    { kind: 'halo', radiusParameter: 'sigma' },
    'scalable',
  ),
  filterProcessor(
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
  filterProcessor(
    'process/noise-reduction',
    'Noise reduction',
    'Reduces high-frequency noise with an alpha-safe tile-aware filter.',
    [numberParameter('amount', 'Amount', 0, 0, 100)],
    { kind: 'halo' },
    'scalable',
  ),
  filterProcessor('process/vignette', 'Vignette', 'Darkens or lifts the image toward its edges.', [
    numberParameter('amount', 'Amount', 0, -100, 100),
  ]),
  filterProcessor('process/grain', 'Grain', 'Adds deterministic tile-stable monochrome grain.', [
    numberParameter('amount', 'Amount', 0, 0, 100),
    { ...numberParameter('seed', 'Seed', 0, 0, 2147483647), integer: true },
  ]),
  processor(
    'process/composite',
    'Composite',
    'Combines a declared secondary image with the primary branch.',
    [
      numberParameter('opacity', 'Secondary opacity', 1, 0, 1),
      {
        default: 'normal',
        description: 'How the secondary image combines with the primary image.',
        key: 'blendMode',
        kind: 'enum',
        label: 'Blend mode',
        values: BLEND_MODES,
      },
    ],
    { kind: 'identity' },
    'exact',
    [{ direction: 'input', key: 'secondary', kind: 'image', label: 'Secondary image' }],
  ),
  processor(
    'process/adjustment-group',
    'Adjustment group',
    'Marks a named scope around a branch and adjusts the scoped result opacity.',
    [numberParameter('amount', 'Group opacity', 1, 0, 1)],
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
      numberParameter('scaleX', 'Scale X', 1, -1000, 1000, 0.01),
      numberParameter('scaleY', 'Scale Y', 1, -1000, 1000, 0.01),
      numberParameter('rotation', 'Rotation', 0, -36000, 36000),
    ],
    ports: [{ direction: 'output', key: 'mask', kind: 'mask', label: 'Mask' }],
    region: { kind: 'source' },
    title: 'Constant mask',
    type: 'source/mask',
  }),
  defineNode({
    childPolicy: 'none',
    description: 'A reusable image dependency with an explicit cache lifetime.',
    kind: 'source',
    parameters: [
      {
        default: 'target',
        description: 'How long derived pixels for this shared branch may remain cached.',
        key: 'cacheLifetime',
        kind: 'enum',
        label: 'Cache lifetime',
        values: ['target', 'project', 'session'],
      },
    ],
    ports: [
      { direction: 'input', key: 'input', kind: 'image', label: 'Shared image' },
      { direction: 'output', key: 'image', kind: 'image', label: 'Image' },
    ],
    region: { kind: 'identity' },
    title: 'Shared image',
    type: 'source/shared',
  }),
  defineNode({
    childPolicy: 'none',
    description: 'A deterministic checker pattern used as a procedural mask.',
    kind: 'source',
    parameters: [
      numberParameter('size', 'Cell size', 32, 1, 100000),
      numberParameter('first', 'First value', 0, 0, 1),
      numberParameter('second', 'Second value', 1, 0, 1),
      numberParameter('offsetX', 'Pattern offset X', 0, -100000, 100000),
      numberParameter('offsetY', 'Pattern offset Y', 0, -100000, 100000),
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
      numberParameter('scaleX', 'Scale X', 1, -1000, 1000, 0.01),
      numberParameter('scaleY', 'Scale Y', 1, -1000, 1000, 0.01),
      numberParameter('rotation', 'Rotation', 0, -36000, 36000),
    ],
    ports: [{ direction: 'output', key: 'mask', kind: 'mask', label: 'Mask' }],
    region: { kind: 'source' },
    title: 'Checker mask',
    type: 'source/checker-mask',
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

  interchangeable(type: string): readonly NodeDefinition[] {
    const group = this.get(type)?.interchangeGroup;
    return group === undefined
      ? []
      : definitions.filter(definition => definition.interchangeGroup === group);
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
