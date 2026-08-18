import { assetAvailability } from './assets.js';
import { cloneProject, parseProject, serializeProject } from './project.js';
import type { AssetResolverState, LinkedImageAsset, PixelfProject } from './types.js';
import { validateProject } from './validation.js';

export interface ProjectTextSource {
  name: string;
  readText(): Promise<string>;
}

export interface ProjectTextDestination {
  name: string;
  writeText(source: string): Promise<void>;
}

export interface ProjectSaveReceipt {
  bytes: number;
  destinationName: string;
  projectId: string;
}

export interface RecoveryStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface RelinkCandidate {
  contentHash: string;
  fileName: string;
  height: number;
  lastModified: number;
  width: number;
}

export async function openProjectFile(source: ProjectTextSource): Promise<PixelfProject> {
  return parseProject(await source.readText());
}

export async function saveProjectFile(
  project: PixelfProject,
  destination: ProjectTextDestination,
): Promise<ProjectSaveReceipt> {
  const source = serializeProject(project);
  await destination.writeText(source);
  return {
    bytes: new TextEncoder().encode(source).byteLength,
    destinationName: destination.name,
    projectId: project.projectId,
  };
}

export class ProjectRecoveryStore {
  constructor(
    private readonly storage: RecoveryStorage,
    private readonly prefix = 'pixelf:recovery:',
  ) {}

  save(project: PixelfProject): void {
    this.storage.setItem(this.key(project.projectId), serializeProject(project));
  }

  load(projectId: string): PixelfProject | null {
    const source = this.storage.getItem(this.key(projectId));
    return source === null ? null : parseProject(source);
  }

  discard(projectId: string): void {
    this.storage.removeItem(this.key(projectId));
  }

  private key(projectId: string): string {
    return `${this.prefix}${projectId}`;
  }
}

export class NamedProjectSession {
  private destination: ProjectTextDestination | null = null;

  constructor(
    private currentProject: PixelfProject,
    readonly recovery: ProjectRecoveryStore,
  ) {
    validateProject(currentProject);
    this.currentProject = cloneProject(currentProject);
  }

  get project(): PixelfProject {
    return cloneProject(this.currentProject);
  }

  replaceProject(project: PixelfProject): void {
    validateProject(project);
    this.currentProject = cloneProject(project);
    this.recovery.save(project);
  }

  async saveAs(destination: ProjectTextDestination): Promise<ProjectSaveReceipt> {
    const receipt = await saveProjectFile(this.currentProject, destination);
    this.destination = destination;
    this.recovery.discard(this.currentProject.projectId);
    return receipt;
  }

  async save(): Promise<ProjectSaveReceipt> {
    if (this.destination === null) throw new Error('Save requires an explicit named destination');
    const receipt = await saveProjectFile(this.currentProject, this.destination);
    this.recovery.discard(this.currentProject.projectId);
    return receipt;
  }

  restoreRecovery(projectId: string): PixelfProject | null {
    const recovered = this.recovery.load(projectId);
    if (recovered !== null) this.currentProject = cloneProject(recovered);
    return recovered;
  }
}

export function relinkMissingAsset(
  project: PixelfProject,
  assetId: string,
  candidate: RelinkCandidate,
  resolver: AssetResolverState,
): PixelfProject {
  const asset = project.assets[assetId];
  if (asset === undefined) throw new Error(`Cannot relink missing asset record ${assetId}`);
  if (asset.storage !== 'linked')
    throw new Error(`${assetId} is embedded and does not need relinking`);
  if (assetAvailability(asset, resolver) !== 'missing') {
    throw new Error(`${assetId} is already available`);
  }
  if (candidate.contentHash !== asset.contentHash) {
    throw new Error('Relinked file content does not match the authored asset identity');
  }
  if (candidate.width !== asset.width || candidate.height !== asset.height) {
    throw new Error('Relinked file dimensions do not match the authored asset');
  }
  const next = cloneProject(project);
  const linked: LinkedImageAsset = {
    ...asset,
    fileName: candidate.fileName,
    lastModified: candidate.lastModified,
  };
  next.assets[assetId] = linked;
  validateProject(next);
  return next;
}
