import type { PixelfProject, ProjectNode } from '../project/types.js';

export type SharedCacheLifetime = 'project' | 'session' | 'target';

function dependencies(
  project: PixelfProject,
  nodeId: string,
  found = new Set<string>(),
): Set<string> {
  if (found.has(nodeId)) return found;
  found.add(nodeId);
  const node = project.nodes[nodeId];
  if (node?.type === 'target') {
    for (const childId of node.childIds) dependencies(project, childId, found);
  } else if (node && 'childId' in node && node.childId !== null) {
    dependencies(project, node.childId, found);
  }
  for (const wire of project.wires) {
    if (wire.to.nodeId === nodeId) dependencies(project, wire.from.nodeId, found);
  }
  return found;
}

function hashText(source: string): string {
  let hash = 2_166_136_261 >>> 0;
  for (const character of source) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function lifetime(node: ProjectNode): SharedCacheLifetime {
  const value = node.parameters.cacheLifetime;
  if (value === 'project' || value === 'session' || value === 'target') return value;
  throw new Error(`${node.id}.cacheLifetime is unsupported`);
}

export function sharedBranchCacheKey(
  project: PixelfProject,
  sharedNodeId: string,
  context: { sessionId: string; targetId: string },
): string {
  const shared = project.nodes[sharedNodeId];
  if (shared?.type !== 'source/shared') throw new Error(`${sharedNodeId} is not a shared image`);
  const wire = project.wires.find(
    candidate => candidate.to.nodeId === shared.id && candidate.to.port === 'input',
  );
  if (wire === undefined) throw new Error(`Shared image ${shared.id} has no input`);
  const dependencyIds = [...dependencies(project, wire.from.nodeId)].sort();
  const assets: Record<string, unknown> = {};
  for (const nodeId of dependencyIds) {
    const node = project.nodes[nodeId];
    if (node?.type === 'source/imported' && node.assetId !== undefined) {
      assets[node.assetId] = project.assets[node.assetId] ?? null;
    }
  }
  const dependencyState = {
    assets,
    nodes: dependencyIds.map(nodeId => project.nodes[nodeId]),
    wires: project.wires
      .filter(wireValue => dependencyIds.includes(wireValue.to.nodeId))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
  const scope = lifetime(shared);
  const owner =
    scope === 'session'
      ? context.sessionId
      : scope === 'project'
        ? project.projectId
        : context.targetId;
  return `shared:${scope}:${owner}:${hashText(JSON.stringify(dependencyState))}`;
}
