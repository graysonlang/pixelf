export type NodeId = string;

export type PrimaryRelation = 'attached-child' | 'ordered-child' | 'root' | 'unary-child';

export interface Row {
  acceptsVisualDepth: boolean;
  depth: number;
  documentIndex: number;
  expanded: boolean;
  hasChildren: boolean;
  height: number;
  kind: string;
  name: string;
  nodeId: NodeId;
  parentId: NodeId | null;
  relation: PrimaryRelation;
  selectable: boolean;
}

export interface ListModel {
  rowTop: Float32Array;
  rows: readonly Row[];
  totalHeight: number;
}

export interface StructureAdapter<Snapshot> {
  childOrder: 'document' | 'reversed';
  childrenOf(snapshot: Snapshot, id: NodeId): readonly NodeId[];
  describe(snapshot: Snapshot, id: NodeId): Omit<Row, 'depth' | 'documentIndex' | 'height'>;
  revisionOf(snapshot: Snapshot): string;
  rootsOf(snapshot: Snapshot): readonly NodeId[];
}

export interface ListSelection {
  focusedNodeId: NodeId | null;
  selectedNodeId: NodeId | null;
}

function orderedChildren<Snapshot>(
  adapter: StructureAdapter<Snapshot>,
  snapshot: Snapshot,
  parentId: NodeId,
): readonly NodeId[] {
  const children = adapter.childrenOf(snapshot, parentId);
  return adapter.childOrder === 'reversed' ? [...children].reverse() : children;
}

export function createListModel<Snapshot>(
  snapshot: Snapshot,
  adapter: StructureAdapter<Snapshot>,
  rowHeight: (row: Omit<Row, 'height'>) => number,
): ListModel {
  const rows: Row[] = [];
  const seen = new Set<NodeId>();

  const visit = (nodeId: NodeId, depth: number, documentIndex: number): void => {
    if (seen.has(nodeId)) throw new Error(`Structure list contains duplicate node ${nodeId}`);
    seen.add(nodeId);
    const described = adapter.describe(snapshot, nodeId);
    const partial: Omit<Row, 'height'> = { ...described, depth, documentIndex };
    rows.push({ ...partial, height: rowHeight(partial) });
    if (!described.expanded) return;
    const children = orderedChildren(adapter, snapshot, nodeId);
    for (const childId of children) {
      const canonical = adapter.childrenOf(snapshot, nodeId).indexOf(childId);
      visit(childId, depth + 1, canonical);
    }
  };

  const roots = adapter.rootsOf(snapshot);
  for (const [index, nodeId] of roots.entries()) visit(nodeId, 0, index);

  const rowTop = new Float32Array(rows.length + 1);
  for (let index = 0; index < rows.length; index += 1) {
    rowTop[index + 1] = (rowTop[index] ?? 0) + (rows[index]?.height ?? 0);
  }
  return { rows, rowTop, totalHeight: rowTop.at(-1) ?? 0 };
}

export function rowIndex(model: ListModel, nodeId: NodeId | null): number {
  if (nodeId === null) return -1;
  return model.rows.findIndex(row => row.nodeId === nodeId);
}

export function normalizedSelection(model: ListModel, selection: ListSelection): ListSelection {
  const fallback = model.rows.find(row => row.selectable)?.nodeId ?? null;
  const focusedNodeId =
    rowIndex(model, selection.focusedNodeId) >= 0 ? selection.focusedNodeId : fallback;
  const selectedNodeId =
    rowIndex(model, selection.selectedNodeId) >= 0 ? selection.selectedNodeId : focusedNodeId;
  return { focusedNodeId, selectedNodeId };
}

export function selectionAt(model: ListModel, index: number): ListSelection | null {
  const row = model.rows[index];
  if (row === undefined || !row.selectable) return null;
  return { focusedNodeId: row.nodeId, selectedNodeId: row.nodeId };
}

export function findTypeaheadIndex(model: ListModel, query: string, currentIndex: number): number {
  const normalized = query.trim().toLocaleLowerCase('en-US');
  if (normalized.length === 0 || model.rows.length === 0) return -1;
  for (let offset = 1; offset <= model.rows.length; offset += 1) {
    const index = (Math.max(-1, currentIndex) + offset) % model.rows.length;
    const row = model.rows[index];
    if (row?.selectable && row.name.toLocaleLowerCase('en-US').startsWith(normalized)) {
      return index;
    }
  }
  return -1;
}
