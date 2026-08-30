import { nodeRegistry, type ParameterDefinition } from './registry.js';
import {
  PIXELF_PROJECT_SCHEMA,
  PIXELF_PROJECT_VERSION,
  type JsonValue,
  type PixelfProject,
  type ProjectNode,
  type TargetContract,
} from './types.js';

const ID_PATTERNS = {
  asset: /^asset-[A-Za-z0-9_-]+$/,
  node: /^node-[A-Za-z0-9_-]+$/,
  project: /^project-[A-Za-z0-9_-]+$/,
  wire: /^wire-[A-Za-z0-9_-]+$/,
};

const CHANNEL_LAYOUTS = new Set(['gray', 'gray-alpha', 'rgb', 'rgba']);
const WORKING_FORMATS = new Set(['rgba8unorm', 'rgba16float', 'rgba32float']);
const COLOR_SPACES = new Set(['srgb', 'display-p3']);
const AUTHORED_COLOR_SPACES = new Set(['automatic', ...COLOR_SPACES]);
const OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp']);
const ALPHA_POLICIES = new Set(['preserve', 'opaque']);
const CANVAS_BACKGROUND_MODES = new Set(['theme', 'light', 'dark', 'custom']);

type UnknownRecord = Record<string, unknown>;

export class ProjectValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid Pixelf project:\n- ${issues.join('\n- ')}`);
    this.name = 'ProjectValidationError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) {
    return typeof value !== 'number' || Number.isFinite(value);
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function checkId(
  value: unknown,
  kind: keyof typeof ID_PATTERNS,
  path: string,
  issues: string[],
): void {
  if (typeof value !== 'string' || !ID_PATTERNS[kind].test(value)) {
    issues.push(`${path} must be an opaque ${kind}-... ID`);
  }
}

function checkPositiveInteger(value: unknown, path: string, issues: string[]): void {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1 || value > 262_144) {
    issues.push(`${path} must be an integer from 1 through 262144`);
  }
}

function checkTargetContract(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  const contract = value as unknown as TargetContract;
  if (contract.width !== null) checkPositiveInteger(contract.width, `${path}.width`, issues);
  if (contract.height !== null) checkPositiveInteger(contract.height, `${path}.height`, issues);
  if (!CHANNEL_LAYOUTS.has(contract.channels)) issues.push(`${path}.channels is unsupported`);
  if (!WORKING_FORMATS.has(contract.workingFormat)) {
    issues.push(`${path}.workingFormat is unsupported`);
  }
  if (!AUTHORED_COLOR_SPACES.has(contract.colorSpace)) {
    issues.push(`${path}.colorSpace is unsupported`);
  }
  if (!OUTPUT_FORMATS.has(contract.outputFormat)) {
    issues.push(`${path}.outputFormat is unsupported`);
  }
  if (contract.outputBitDepth !== 8 && contract.outputBitDepth !== 16) {
    issues.push(`${path}.outputBitDepth must be 8 or 16`);
  }
  if (!ALPHA_POLICIES.has(contract.alphaPolicy)) {
    issues.push(`${path}.alphaPolicy is unsupported`);
  }
  if (contract.outputFormat === 'jpeg' && contract.outputBitDepth !== 8) {
    issues.push(`${path} JPEG output currently requires 8-bit output`);
  }
  if (contract.outputFormat === 'jpeg' && contract.alphaPolicy !== 'opaque') {
    issues.push(`${path} JPEG output requires an opaque alpha policy`);
  }
  if (contract.outputFormat === 'webp' && contract.outputBitDepth !== 8) {
    issues.push(`${path} WebP output currently requires 8-bit output`);
  }
}

function checkCanvasBackground(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  if (!CANVAS_BACKGROUND_MODES.has(value.mode as string)) {
    issues.push(`${path}.mode is unsupported`);
  }
  if (typeof value.visible !== 'boolean') issues.push(`${path}.visible must be a boolean`);
  if (value.color === undefined) return;
  if (!isRecord(value.color)) {
    issues.push(`${path}.color must be an RGBA object`);
    return;
  }
  for (const channel of ['r', 'g', 'b', 'a'] as const) {
    const component = value.color[channel];
    if (
      typeof component !== 'number' ||
      !Number.isFinite(component) ||
      component < 0 ||
      component > 1
    ) {
      issues.push(`${path}.color.${channel} must be a number from 0 through 1`);
    }
  }
}

function checkParameter(
  value: unknown,
  definition: ParameterDefinition,
  path: string,
  issues: string[],
): void {
  if (!isJsonValue(value)) {
    issues.push(`${path} must be a JSON value`);
    return;
  }
  if (definition.kind === 'boolean' && typeof value !== 'boolean') {
    issues.push(`${path} must be a boolean`);
    return;
  }
  if (definition.kind === 'string' && typeof value !== 'string') {
    issues.push(`${path} must be a string`);
    return;
  }
  if (
    definition.kind === 'string' &&
    definition.presentation === 'color' &&
    (typeof value !== 'string' || !/^#[a-f\d]{6}$/i.test(value))
  ) {
    issues.push(`${path} must be a six-digit hex color`);
    return;
  }
  if (definition.kind === 'enum') {
    if (typeof value !== 'string' || !definition.values?.includes(value)) {
      issues.push(`${path} must be one of: ${definition.values?.join(', ') ?? ''}`);
    }
    return;
  }
  if (definition.kind !== 'number') return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(`${path} must be a finite number`);
    return;
  }
  if (definition.integer && !Number.isInteger(value)) issues.push(`${path} must be an integer`);
  if (definition.minimum !== undefined && value < definition.minimum) {
    issues.push(`${path} must be at least ${definition.minimum}`);
  }
  if (definition.maximum !== undefined && value > definition.maximum) {
    issues.push(`${path} must be at most ${definition.maximum}`);
  }
}

function checkNodeShape(node: UnknownRecord, key: string, issues: string[]): void {
  const path = `nodes.${key}`;
  checkId(node.id, 'node', `${path}.id`, issues);
  if (node.id !== key) issues.push(`${path}.id must match its record key`);
  if (typeof node.name !== 'string' || node.name.trim() === '') {
    issues.push(`${path}.name must be a non-empty string`);
  }
  if (typeof node.type !== 'string') {
    issues.push(`${path}.type must be a string`);
    return;
  }
  const definition = nodeRegistry.get(node.type);
  if (definition === undefined) {
    issues.push(`${path}.type is unsupported: ${node.type}`);
    return;
  }
  let parameterDefinition = definition;
  if (node.type === 'filter') {
    if (typeof node.filterType !== 'string') {
      issues.push(`${path}.filterType must name a filter operation`);
    } else {
      const filterDefinition = nodeRegistry.get(node.filterType);
      if (filterDefinition?.interchangeGroup !== 'filter') {
        issues.push(`${path}.filterType is unsupported: ${node.filterType}`);
      } else {
        parameterDefinition = filterDefinition;
      }
    }
  }
  if (node.type === 'content') {
    if (typeof node.contentType !== 'string') {
      issues.push(`${path}.contentType must name a content generator`);
    } else {
      const contentDefinition = nodeRegistry.get(node.contentType);
      if (contentDefinition?.interchangeGroup !== 'content') {
        issues.push(`${path}.contentType is unsupported: ${node.contentType}`);
      } else {
        parameterDefinition = contentDefinition;
      }
    }
  }
  if (!isRecord(node.parameters)) {
    issues.push(`${path}.parameters must be an object`);
  } else {
    const expected = new Set(parameterDefinition.parameters.map(parameter => parameter.key));
    for (const parameter of parameterDefinition.parameters) {
      checkParameter(
        node.parameters[parameter.key],
        parameter,
        `${path}.parameters.${parameter.key}`,
        issues,
      );
    }
    for (const key of Object.keys(node.parameters)) {
      if (!expected.has(key))
        issues.push(`${path}.parameters.${key} is not declared by ${parameterDefinition.type}`);
    }
  }
  if (
    node.type === 'layer' ||
    node.type === 'filter' ||
    node.type === 'content' ||
    node.type === 'group'
  ) {
    if (typeof node.visible !== 'boolean') issues.push(`${path}.visible must be a boolean`);
    if (typeof node.locked !== 'boolean') issues.push(`${path}.locked must be a boolean`);
  }
  if (node.type === 'layer' || node.type === 'group') {
    if (!Array.isArray(node.effectIds) || !node.effectIds.every(id => typeof id === 'string')) {
      issues.push(`${path}.effectIds must be an array of effect IDs`);
    }
  }
  if (definition.childPolicy === 'layers') {
    if (!Array.isArray(node.childIds) || !node.childIds.every(id => typeof id === 'string')) {
      issues.push(`${path}.childIds must be an array of layer IDs`);
    }
    checkTargetContract(node.contract, `${path}.contract`, issues);
    if (node.background !== undefined) {
      checkCanvasBackground(node.background, `${path}.background`, issues);
    }
  } else if (definition.childPolicy === 'stack') {
    if (!Array.isArray(node.childIds) || !node.childIds.every(id => typeof id === 'string')) {
      issues.push(`${path}.childIds must be an array of stack-item IDs`);
    }
  } else if (definition.childPolicy === 'one') {
    if (node.childId !== null && typeof node.childId !== 'string') {
      issues.push(`${path}.childId must be a node ID or null`);
    }
  } else if ('childId' in node || 'childIds' in node) {
    issues.push(`${path} is a source leaf and cannot own primary children`);
  }
  if (node.type === 'source/imported') checkId(node.assetId, 'asset', `${path}.assetId`, issues);
}

function checkWireShape(value: unknown, index: number, issues: string[]): void {
  const path = `wires.${index}`;
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  checkId(value.id, 'wire', `${path}.id`, issues);
  for (const direction of ['from', 'to'] as const) {
    const endpoint = value[direction];
    if (!isRecord(endpoint)) {
      issues.push(`${path}.${direction} must be an endpoint object`);
      continue;
    }
    checkId(endpoint.nodeId, 'node', `${path}.${direction}.nodeId`, issues);
    if (typeof endpoint.port !== 'string' || endpoint.port === '') {
      issues.push(`${path}.${direction}.port must be a non-empty string`);
    }
  }
}

function primaryChildren(node: ProjectNode): readonly string[] {
  if (node.type === 'target' || node.type === 'group') return node.childIds;
  if ('childId' in node) {
    return node.childId === null ? [] : [node.childId];
  }
  return [];
}

function checkAssets(project: PixelfProject, issues: string[]): void {
  for (const [key, asset] of Object.entries(project.assets)) {
    const path = `assets.${key}`;
    if (!isRecord(asset)) {
      issues.push(`${path} must be an object`);
      continue;
    }
    checkId(asset.id, 'asset', `${path}.id`, issues);
    if (asset.id !== key) issues.push(`${path}.id must match its record key`);
    if (asset.kind !== 'image') issues.push(`${path}.kind must be image`);
    if (typeof asset.name !== 'string' || asset.name.trim() === '') {
      issues.push(`${path}.name must be a non-empty string`);
    }
    if (typeof asset.mediaType !== 'string' || !asset.mediaType.startsWith('image/')) {
      issues.push(`${path}.mediaType must be an image media type`);
    }
    checkPositiveInteger(asset.width, `${path}.width`, issues);
    checkPositiveInteger(asset.height, `${path}.height`, issues);
    if (!COLOR_SPACES.has(asset.colorSpace as string))
      issues.push(`${path}.colorSpace is unsupported`);
    if (typeof asset.contentHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(asset.contentHash)) {
      issues.push(`${path}.contentHash must be a lowercase sha256 digest`);
    }
    if (asset.storage === 'embedded') {
      if (
        typeof asset.bytesBase64 !== 'string' ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.bytesBase64)
      ) {
        issues.push(`${path}.bytesBase64 must be base64 data`);
      }
    } else if (asset.storage === 'linked') {
      if (typeof asset.fileName !== 'string' || asset.fileName === '') {
        issues.push(`${path}.fileName must identify the linked file`);
      }
      if (typeof asset.lastModified !== 'number' || !Number.isFinite(asset.lastModified)) {
        issues.push(`${path}.lastModified must be a finite timestamp`);
      }
    } else {
      issues.push(`${path}.storage must be embedded or linked`);
    }
  }
}

function checkTreeAndWires(project: PixelfProject, issues: string[]): void {
  const parentCounts = new Map<string, number>();
  const dependencies = new Map<string, string[]>();
  for (const nodeId of Object.keys(project.nodes)) dependencies.set(nodeId, []);

  for (const [nodeId, node] of Object.entries(project.nodes)) {
    for (const childId of primaryChildren(node)) {
      const child = project.nodes[childId];
      if (child === undefined) {
        issues.push(`nodes.${nodeId} references missing primary child ${childId}`);
        continue;
      }
      if (
        (node.type === 'target' || node.type === 'group') &&
        child.type !== 'layer' &&
        child.type !== 'filter' &&
        child.type !== 'content' &&
        child.type !== 'group'
      ) {
        issues.push(`${node.type} ${nodeId} may contain only stack items, not ${child.type}`);
      }
      if (
        node.type !== 'target' &&
        node.type !== 'group' &&
        (child.type === 'target' ||
          child.type === 'layer' ||
          child.type === 'filter' ||
          child.type === 'content' ||
          child.type === 'group')
      ) {
        issues.push(
          `${node.type} ${nodeId} cannot use ${child.type} ${childId} as its unary child`,
        );
      }
      parentCounts.set(childId, (parentCounts.get(childId) ?? 0) + 1);
      dependencies.get(nodeId)?.push(childId);
    }
  }
  for (const [nodeId, count] of parentCounts) {
    if (count > 1) issues.push(`node ${nodeId} has ${count} primary parents; only one is allowed`);
  }

  const targetSet = new Set(project.targetIds);
  if (targetSet.size !== project.targetIds.length) issues.push('targetIds contains duplicates');
  for (const targetId of project.targetIds) {
    const node = project.nodes[targetId];
    if (node === undefined) issues.push(`targetIds references missing node ${targetId}`);
    else if (node.type !== 'target') issues.push(`targetIds entry ${targetId} is not a target`);
  }
  for (const node of Object.values(project.nodes)) {
    if (node.type === 'target' && !targetSet.has(node.id)) {
      issues.push(`target node ${node.id} is not listed in targetIds`);
    }
  }

  const connectedInputs = new Set<string>();
  const wireIds = new Set<string>();
  for (const wire of project.wires) {
    checkId(wire.id, 'wire', 'wire.id', issues);
    if (wireIds.has(wire.id)) issues.push(`duplicate wire ID ${wire.id}`);
    wireIds.add(wire.id);
    const fromNode = project.nodes[wire.from.nodeId];
    const toNode = project.nodes[wire.to.nodeId];
    if (fromNode === undefined) {
      issues.push(`wire ${wire.id} references missing source node ${wire.from.nodeId}`);
      continue;
    }
    if (toNode === undefined) {
      issues.push(`wire ${wire.id} references missing destination node ${wire.to.nodeId}`);
      continue;
    }
    const fromPort = nodeRegistry.port(fromNode, wire.from.port, 'output');
    const toPort = nodeRegistry.port(toNode, wire.to.port, 'input');
    if (fromPort === undefined) {
      issues.push(
        `wire ${wire.id} references missing output ${wire.from.nodeId}.${wire.from.port}`,
      );
      continue;
    }
    if (toPort === undefined) {
      issues.push(`wire ${wire.id} references missing input ${wire.to.nodeId}.${wire.to.port}`);
      continue;
    }
    if (fromPort.kind !== toPort.kind) {
      issues.push(
        `wire ${wire.id} connects incompatible ${fromPort.kind} and ${toPort.kind} ports`,
      );
    }
    const inputKey = `${wire.to.nodeId}:${wire.to.port}`;
    if (!toPort.multiple && connectedInputs.has(inputKey)) {
      issues.push(`input ${inputKey} accepts only one wire`);
    }
    connectedInputs.add(inputKey);
    dependencies.get(wire.to.nodeId)?.push(wire.from.nodeId);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      issues.push(`dependency cycle includes node ${nodeId}`);
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const dependency of dependencies.get(nodeId) ?? []) visit(dependency);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of Object.keys(project.nodes)) visit(nodeId);
}

export function validateProject(value: unknown): asserts value is PixelfProject {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ProjectValidationError(['project must be an object']);
  if (value.schema !== PIXELF_PROJECT_SCHEMA) {
    issues.push(`schema must be ${PIXELF_PROJECT_SCHEMA}`);
  }
  if (value.version !== PIXELF_PROJECT_VERSION) {
    issues.push(`version must be ${PIXELF_PROJECT_VERSION}`);
  }
  checkId(value.projectId, 'project', 'projectId', issues);
  if (typeof value.name !== 'string' || value.name.trim() === '') {
    issues.push('name must be a non-empty string');
  }
  if (!isRecord(value.nodes)) issues.push('nodes must be an object');
  else
    for (const [key, node] of Object.entries(value.nodes)) {
      if (!isRecord(node)) issues.push(`nodes.${key} must be an object`);
      else checkNodeShape(node, key, issues);
    }
  if (!isRecord(value.assets)) issues.push('assets must be an object');
  if (!Array.isArray(value.targetIds) || !value.targetIds.every(id => typeof id === 'string')) {
    issues.push('targetIds must be an array of target node IDs');
  } else {
    for (let index = 0; index < value.targetIds.length; index += 1) {
      checkId(value.targetIds[index], 'node', `targetIds.${index}`, issues);
    }
  }
  if (!Array.isArray(value.wires)) issues.push('wires must be an array');
  else
    value.wires.forEach((wire, index) => {
      checkWireShape(wire, index, issues);
    });

  if (issues.length === 0) {
    const project = value as unknown as PixelfProject;
    checkAssets(project, issues);
    for (const node of Object.values(project.nodes)) {
      if (node.type === 'source/imported' && project.assets[node.assetId ?? ''] === undefined) {
        issues.push(`imported source ${node.id} references missing asset metadata ${node.assetId}`);
      }
    }
    checkTreeAndWires(project, issues);
  }
  if (issues.length > 0) throw new ProjectValidationError(issues);
}
