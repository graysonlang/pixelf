import { nodeRegistry } from './registry.js';
import {
  PIXELF_PROJECT_SCHEMA,
  PIXELF_PROJECT_VERSION,
  type ImageAsset,
  type FilterLayerNode,
  type JsonValue,
  type LayerNode,
  type PixelfProject,
  type ProcessorNode,
  type ProjectColorSpace,
  type ProjectNode,
  type ResolvedTargetContract,
  type SourceNode,
  type TargetContract,
  type TargetNode,
} from './types.js';
import { ProjectValidationError, validateProject } from './validation.js';

type IdKind = 'asset' | 'node' | 'project' | 'wire';
type UnknownRecord = Record<string, unknown>;

export const DEFAULT_TARGET_CONTRACT: Readonly<TargetContract> = Object.freeze({
  alphaPolicy: 'preserve',
  channels: 'rgba',
  colorSpace: 'automatic',
  height: null,
  outputBitDepth: 8,
  outputFormat: 'png',
  width: null,
  workingFormat: 'rgba16float',
});

export function createOpaqueId(kind: IdKind, entropy?: string): string {
  const value = entropy ?? globalThis.crypto.randomUUID();
  return `${kind}-${value.replaceAll(/[^A-Za-z0-9_-]/g, '')}`;
}

export function createNode(
  type: string,
  id = createOpaqueId('node'),
  name = nodeRegistry.require(type).title,
): ProjectNode {
  const parameters = nodeRegistry.defaults(type);
  if (type === 'target') {
    return {
      childIds: [],
      contract: { ...DEFAULT_TARGET_CONTRACT },
      id,
      name,
      parameters,
      type: 'target',
    };
  }
  if (type === 'layer') {
    return {
      childId: null,
      effectIds: [],
      id,
      locked: false,
      name,
      parameters,
      type: 'layer',
      visible: true,
    };
  }
  if (type === 'filter') {
    const filterType = 'process/exposure';
    return {
      filterType,
      id,
      locked: false,
      name,
      parameters: nodeRegistry.defaults(filterType),
      type: 'filter',
      visible: true,
    } as FilterLayerNode;
  }
  if (type.startsWith('process/')) {
    return { childId: null, id, name, parameters, type } as ProcessorNode;
  }
  if (type.startsWith('source/')) return { id, name, parameters, type } as SourceNode;
  throw new Error(`Unsupported node type: ${type}`);
}

export function createEmptyProject(
  name = 'Untitled',
  projectId = createOpaqueId('project'),
): PixelfProject {
  return {
    assets: {},
    name,
    nodes: {},
    projectId,
    schema: PIXELF_PROJECT_SCHEMA,
    targetIds: [],
    version: PIXELF_PROJECT_VERSION,
    wires: [],
  };
}

export function createUntitledCompositeProject(
  name = 'Untitled',
  projectId = createOpaqueId('project'),
  targetId = createOpaqueId('node'),
): PixelfProject {
  const target = createNode('target', targetId, name) as TargetNode;
  const project = {
    ...createEmptyProject(name, projectId),
    nodes: { [target.id]: target },
    targetIds: [target.id],
  };
  validateProject(project);
  return project;
}

function importedColorSpaces(project: PixelfProject, target: TargetNode): ProjectColorSpace[] {
  const spaces = new Set<ProjectColorSpace>();
  const pending = [...target.childIds];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (nodeId === undefined || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = project.nodes[nodeId];
    if (node === undefined) continue;
    if (node.type === 'source/imported' && node.assetId !== undefined) {
      const asset = project.assets[node.assetId];
      if (asset !== undefined) spaces.add(asset.colorSpace);
    }
    if ('childId' in node && node.childId !== null) pending.push(node.childId);
  }
  return [...spaces].sort();
}

export function resolveTargetContract(
  project: PixelfProject,
  target: TargetNode,
): ResolvedTargetContract | null {
  if (target.contract.width === null || target.contract.height === null) return null;
  const colorSpace =
    target.contract.colorSpace === 'automatic'
      ? importedColorSpaces(project, target).includes('display-p3')
        ? 'display-p3'
        : 'srgb'
      : target.contract.colorSpace;
  return {
    ...target.contract,
    colorSpace,
    height: target.contract.height,
    width: target.contract.width,
  };
}

export interface ImportedProjectIds {
  layerId: string;
  projectId: string;
  sourceId: string;
  targetId: string;
}

function projectNameFromAsset(name: string): string {
  const stripped = name.replace(/\.[^.]+$/, '').trim();
  return stripped.length > 0 ? stripped : 'Untitled';
}

export function createImportedProject(
  asset: ImageAsset,
  ids: ImportedProjectIds = {
    layerId: createOpaqueId('node'),
    projectId: createOpaqueId('project'),
    sourceId: createOpaqueId('node'),
    targetId: createOpaqueId('node'),
  },
): PixelfProject {
  const projectName = projectNameFromAsset(asset.name);
  const target = createNode('target', ids.targetId, asset.name) as TargetNode;
  target.contract = { ...target.contract, height: asset.height, width: asset.width };
  target.childIds = [ids.layerId];
  const layer = createNode('layer', ids.layerId, asset.name) as LayerNode;
  layer.childId = ids.sourceId;
  const source = createNode('source/imported', ids.sourceId, asset.name) as SourceNode;
  source.assetId = asset.id;
  const project: PixelfProject = {
    ...createEmptyProject(projectName, ids.projectId),
    assets: { [asset.id]: asset },
    nodes: {
      [target.id]: target,
      [layer.id]: layer,
      [source.id]: source,
    },
    targetIds: [target.id],
  };
  validateProject(project);
  return project;
}

export function cloneProject(project: PixelfProject): PixelfProject {
  return structuredClone(project);
}

function sortedJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortedJson(child)]),
  );
}

export function serializeProject(project: PixelfProject): string {
  validateProject(project);
  return `${JSON.stringify(sortedJson(project as unknown as JsonValue), null, 2)}\n`;
}

function migrateVersionZero(value: UnknownRecord): UnknownRecord {
  const migrated = structuredClone(value);
  migrated.version = 1;
  if (typeof migrated.nodes === 'object' && migrated.nodes !== null) {
    for (const node of Object.values(migrated.nodes as UnknownRecord)) {
      if (typeof node !== 'object' || node === null) continue;
      const record = node as UnknownRecord;
      if (
        record.type !== 'target' ||
        typeof record.contract !== 'object' ||
        record.contract === null
      ) {
        continue;
      }
      const contract = record.contract as UnknownRecord;
      if (contract.outputBitDepth === undefined && contract.bitDepth !== undefined) {
        contract.outputBitDepth = contract.bitDepth;
        delete contract.bitDepth;
      }
    }
  }
  return migrated;
}

function migrateVersionOne(value: UnknownRecord): UnknownRecord {
  const migrated = structuredClone(value);
  migrated.version = 2;
  if (typeof migrated.nodes === 'object' && migrated.nodes !== null) {
    for (const node of Object.values(migrated.nodes as UnknownRecord)) {
      if (typeof node !== 'object' || node === null) continue;
      const record = node as UnknownRecord;
      if (
        record.type !== 'layer' ||
        typeof record.parameters !== 'object' ||
        record.parameters === null ||
        Array.isArray(record.parameters)
      ) {
        continue;
      }
      const parameters = record.parameters as UnknownRecord;
      if (parameters.fill === undefined) parameters.fill = 1;
    }
  }
  return migrated;
}

function migrateVersionTwo(value: UnknownRecord): UnknownRecord {
  const migrated = structuredClone(value);
  migrated.version = 3;
  if (typeof migrated.nodes === 'object' && migrated.nodes !== null) {
    for (const node of Object.values(migrated.nodes as UnknownRecord)) {
      if (typeof node !== 'object' || node === null) continue;
      const record = node as UnknownRecord;
      if (record.type !== 'layer' && record.type !== 'filter') continue;
      if (record.visible === undefined) record.visible = true;
      if (record.locked === undefined) record.locked = false;
    }
  }
  return migrated;
}

function migrateVersionThree(value: UnknownRecord): UnknownRecord {
  const migrated = structuredClone(value);
  migrated.version = 4;
  if (typeof migrated.nodes === 'object' && migrated.nodes !== null) {
    for (const node of Object.values(migrated.nodes as UnknownRecord)) {
      if (typeof node !== 'object' || node === null) continue;
      const record = node as UnknownRecord;
      if (record.type === 'layer' && record.effectIds === undefined) record.effectIds = [];
    }
  }
  return migrated;
}

const migrations = new Map<number, (value: UnknownRecord) => UnknownRecord>([
  [0, migrateVersionZero],
  [1, migrateVersionOne],
  [2, migrateVersionTwo],
  [3, migrateVersionThree],
]);

export function migrateProject(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  let current = structuredClone(value) as UnknownRecord;
  if (current.schema !== PIXELF_PROJECT_SCHEMA) return current;
  while (typeof current.version === 'number' && current.version < PIXELF_PROJECT_VERSION) {
    const migrate = migrations.get(current.version);
    if (migrate === undefined) {
      throw new ProjectValidationError([
        `no migration is available from version ${current.version}`,
      ]);
    }
    current = migrate(current);
  }
  if (typeof current.version === 'number' && current.version > PIXELF_PROJECT_VERSION) {
    throw new ProjectValidationError([
      `project version ${current.version} is newer than supported version ${PIXELF_PROJECT_VERSION}`,
    ]);
  }
  return current;
}

export function parseProject(source: string): PixelfProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ProjectValidationError([`project is not valid JSON: ${message}`]);
  }
  const migrated = migrateProject(parsed);
  validateProject(migrated);
  return migrated;
}

export interface PrimaryParent {
  index: number;
  node: TargetNode | LayerNode | ProcessorNode;
}

export function findPrimaryParent(project: PixelfProject, childId: string): PrimaryParent | null {
  for (const node of Object.values(project.nodes)) {
    if (node.type === 'target') {
      const index = node.childIds.indexOf(childId);
      if (index >= 0) return { index, node };
    } else if ('childId' in node && node.childId === childId) {
      return { index: 0, node };
    }
  }
  return null;
}
