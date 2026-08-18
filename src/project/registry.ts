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
  kind: 'identity' | 'source';
}

export interface NodeDefinition {
  childPolicy: PrimaryChildPolicy;
  description: string;
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
        values: ['normal'],
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
    childPolicy: 'one',
    description: 'A reversible opacity adjustment in the primary image path.',
    kind: 'processor',
    parameters: [
      {
        default: 1,
        description: 'The output contribution from transparent to fully visible.',
        key: 'amount',
        kind: 'number',
        label: 'Amount',
        maximum: 1,
        minimum: 0,
      },
      {
        default: false,
        description: 'Pass the child image through without applying this operation.',
        key: 'bypass',
        kind: 'boolean',
        label: 'Bypass',
      },
    ],
    ports: [{ direction: 'output', key: 'image', kind: 'image', label: 'Image' }],
    region: { kind: 'identity' },
    title: 'Opacity',
    type: 'process/opacity',
  }),
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
