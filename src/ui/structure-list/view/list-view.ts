import type { DensityPolicy } from '../density.js';
import {
  findTypeaheadIndex,
  normalizedSelection,
  rowIndex,
  type ListModel,
  type Row,
} from '../model.js';

export interface StructureListViewOptions {
  density: DensityPolicy;
  dependencyCount?: (row: Row) => number;
  focusedNodeId: string | null;
  onDelete?(nodeId: string): void;
  onMove?(nodeId: string, direction: -1 | 1): void;
  onOpenActions?(nodeId: string, anchor?: { x: number; y: number }): void;
  onPrimaryAction?(nodeId: string): void;
  onReorder?(nodeId: string, anchorNodeId: string, placement: 'after' | 'before'): void;
  onSelect(nodeId: string): void;
  onToggle(nodeId: string): void;
  selectedNodeId: string | null;
  summary?: (row: Row) => string;
}

interface TypeaheadState {
  at: number;
  query: string;
}

const typeaheadState = new WeakMap<HTMLElement, TypeaheadState>();

function glyphFor(kind: string): string {
  if (kind === 'target') return 'C';
  if (kind === 'layer') return 'L';
  if (kind === 'filter') return 'fx';
  if (kind === 'source/mask' || kind === 'source/checker-mask') return 'M';
  if (kind.startsWith('process/')) return 'fx';
  return 'S';
}

function siblingMetadata(model: ListModel): Map<string, { position: number; size: number }> {
  const groups = new Map<string | null, Row[]>();
  for (const row of model.rows) {
    const siblings = groups.get(row.parentId) ?? [];
    siblings.push(row);
    groups.set(row.parentId, siblings);
  }
  const metadata = new Map<string, { position: number; size: number }>();
  for (const siblings of groups.values()) {
    for (const [index, row] of siblings.entries()) {
      metadata.set(row.nodeId, { position: index + 1, size: siblings.length });
    }
  }
  return metadata;
}

function focusRenderedRow(container: HTMLElement, nodeId: string): void {
  requestAnimationFrame(() => {
    const rows = container.querySelectorAll<HTMLElement>('[role="treeitem"]');
    for (const row of rows) {
      if (row.dataset.nodeId === nodeId) {
        row.focus();
        return;
      }
    }
  });
}

export function renderStructureList(
  container: HTMLElement,
  model: ListModel,
  options: StructureListViewOptions,
): void {
  const selection = normalizedSelection(model, {
    focusedNodeId: options.focusedNodeId,
    selectedNodeId: options.selectedNodeId,
  });
  const siblingData = siblingMetadata(model);
  const fragment = document.createDocumentFragment();
  let draggedNodeId: string | null = null;
  container.dataset.density = options.density.density;

  const clearDropState = (): void => {
    for (const element of container.querySelectorAll<HTMLElement>('.structure-chiclet')) {
      element.classList.remove('dragging', 'drop-before', 'drop-after');
      element.removeAttribute('aria-grabbed');
    }
  };

  for (const row of model.rows) {
    const shell = document.createElement('div');
    shell.className = 'structure-row-shell';
    shell.style.setProperty('--structure-depth', String(row.depth));
    shell.style.setProperty('--structure-row-height', `${row.height}px`);
    shell.style.setProperty('--structure-thumbnail-size', `${options.density.thumbnailSize}px`);

    const chiclet = document.createElement('div');
    chiclet.className = `structure-chiclet kind-${row.kind.replaceAll('/', '-')}`;
    chiclet.dataset.nodeId = row.nodeId;
    chiclet.dataset.testid = `structure-row-${row.nodeId}`;
    chiclet.role = 'treeitem';
    chiclet.tabIndex = selection.focusedNodeId === row.nodeId ? 0 : -1;
    chiclet.setAttribute('aria-label', row.name);
    chiclet.setAttribute('aria-level', String(row.depth + 1));
    chiclet.setAttribute('aria-selected', String(options.selectedNodeId === row.nodeId));
    const reorderable = (row.kind === 'filter' || row.kind === 'layer') && row.relation === 'root';
    chiclet.draggable = reorderable;
    if (reorderable) chiclet.dataset.reorderable = 'true';
    const siblings = siblingData.get(row.nodeId);
    if (siblings !== undefined) {
      chiclet.setAttribute('aria-posinset', String(siblings.position));
      chiclet.setAttribute('aria-setsize', String(siblings.size));
    }
    if (row.hasChildren) chiclet.setAttribute('aria-expanded', String(row.expanded));

    const disclosure = row.hasChildren
      ? document.createElement('button')
      : document.createElement('span');
    disclosure.className = 'structure-disclosure';
    if (row.hasChildren) {
      if (!(disclosure instanceof HTMLButtonElement)) throw new Error('Expected button');
      disclosure.type = 'button';
      disclosure.tabIndex = -1;
      disclosure.setAttribute('aria-label', `${row.expanded ? 'Collapse' : 'Expand'} ${row.name}`);
      disclosure.textContent = row.expanded ? '-' : '+';
      disclosure.addEventListener('click', event => {
        event.stopPropagation();
        options.onToggle(row.nodeId);
      });
    } else {
      disclosure.setAttribute('aria-hidden', 'true');
      disclosure.textContent = '';
    }

    const interior = document.createElement('span');
    interior.className = 'structure-interior';
    const glyph = document.createElement('span');
    glyph.className = 'structure-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = glyphFor(row.kind);
    const copy = document.createElement('span');
    copy.className = 'structure-copy';
    const name = document.createElement('strong');
    name.textContent = row.name;
    copy.append(name);
    if (options.density.showMetadata) {
      const summary = document.createElement('span');
      summary.textContent = options.summary?.(row) ?? row.kind;
      copy.append(summary);
    }
    interior.append(glyph, copy);

    const count = options.dependencyCount?.(row) ?? 0;
    if (count > 0) {
      const badge = document.createElement('span');
      badge.className = 'structure-dependency-badge';
      badge.setAttribute('aria-label', `${count} ${count === 1 ? 'dependency' : 'dependencies'}`);
      badge.textContent = String(count);
      interior.append(badge);
    }

    const actions = document.createElement('button');
    actions.className = 'structure-actions-trigger';
    actions.type = 'button';
    actions.tabIndex = -1;
    actions.dataset.testid = `structure-action-menu-${row.nodeId}`;
    actions.setAttribute('aria-label', `Actions for ${row.name}`);
    actions.textContent = '...';
    actions.addEventListener('click', event => {
      event.stopPropagation();
      const bounds = actions.getBoundingClientRect();
      options.onSelect(row.nodeId);
      options.onOpenActions?.(row.nodeId, { x: bounds.right, y: bounds.bottom });
    });

    chiclet.append(disclosure, interior, actions);
    chiclet.addEventListener('click', () => options.onSelect(row.nodeId));
    chiclet.addEventListener('focus', () => {
      if (selection.focusedNodeId !== row.nodeId) options.onSelect(row.nodeId);
    });
    chiclet.addEventListener('contextmenu', event => {
      event.preventDefault();
      options.onSelect(row.nodeId);
      options.onOpenActions?.(row.nodeId, { x: event.clientX, y: event.clientY });
    });
    if (reorderable) {
      chiclet.addEventListener('dragstart', event => {
        draggedNodeId = row.nodeId;
        chiclet.classList.add('dragging');
        chiclet.setAttribute('aria-grabbed', 'true');
        if (event.dataTransfer !== null) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-pixelf-layer', row.nodeId);
        }
      });
      chiclet.addEventListener('dragover', event => {
        if (draggedNodeId === null || draggedNodeId === row.nodeId) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move';
        const bounds = chiclet.getBoundingClientRect();
        const placement = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
        chiclet.classList.toggle('drop-before', placement === 'before');
        chiclet.classList.toggle('drop-after', placement === 'after');
      });
      chiclet.addEventListener('dragleave', event => {
        if (event.relatedTarget instanceof Node && chiclet.contains(event.relatedTarget)) return;
        chiclet.classList.remove('drop-before', 'drop-after');
      });
      chiclet.addEventListener('drop', event => {
        if (draggedNodeId === null || draggedNodeId === row.nodeId) return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = chiclet.getBoundingClientRect();
        const placement = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
        const movedNodeId = draggedNodeId;
        clearDropState();
        draggedNodeId = null;
        options.onReorder?.(movedNodeId, row.nodeId, placement);
      });
      chiclet.addEventListener('dragend', () => {
        clearDropState();
        draggedNodeId = null;
      });
    }
    shell.append(chiclet);
    fragment.append(shell);
  }

  container.replaceChildren(fragment);
  container.onkeydown = event => {
    const currentIndex = Math.max(0, rowIndex(model, options.focusedNodeId));
    const current = model.rows[currentIndex];
    const selectAt = (index: number): void => {
      const row = model.rows[index];
      if (row === undefined || !row.selectable) return;
      options.onSelect(row.nodeId);
      focusRenderedRow(container, row.nodeId);
    };

    if ((event.metaKey || event.ctrlKey) && event.key === '.') {
      if (current !== undefined) options.onOpenActions?.(current.nodeId);
      event.preventDefault();
      return;
    }

    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      current?.kind === 'layer' &&
      current.relation === 'root'
    ) {
      options.onMove?.(current.nodeId, event.key === 'ArrowUp' ? -1 : 1);
      event.preventDefault();
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        selectAt(Math.min(model.rows.length - 1, currentIndex + 1));
        break;
      case 'ArrowUp':
        selectAt(Math.max(0, currentIndex - 1));
        break;
      case 'Home':
        selectAt(0);
        break;
      case 'End':
        selectAt(model.rows.length - 1);
        break;
      case 'ArrowRight':
        if (current?.hasChildren && !current.expanded) options.onToggle(current.nodeId);
        else if (model.rows[currentIndex + 1]?.parentId === current?.nodeId) {
          selectAt(currentIndex + 1);
        }
        break;
      case 'ArrowLeft':
        if (current?.hasChildren && current.expanded) options.onToggle(current.nodeId);
        else if (current?.parentId !== null && current?.parentId !== undefined) {
          const parentIndex = rowIndex(model, current.parentId);
          if (parentIndex >= 0) selectAt(parentIndex);
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (current !== undefined) options.onDelete?.(current.nodeId);
        break;
      case 'Enter':
        if (current !== undefined) options.onPrimaryAction?.(current.nodeId);
        break;
      case ' ':
        if (current !== undefined) options.onSelect(current.nodeId);
        break;
      default: {
        if (
          event.key.length !== 1 ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.key.trim().length === 0
        ) {
          return;
        }
        const now = performance.now();
        const previous = typeaheadState.get(container);
        const key = event.key.toLocaleLowerCase('en-US');
        const withinWindow = previous !== undefined && now - previous.at < 700;
        const repeated =
          withinWindow && previous.query.split('').every(character => character === key);
        const query = withinWindow && !repeated ? `${previous.query}${key}` : key;
        typeaheadState.set(container, { at: now, query });
        const match = findTypeaheadIndex(model, query, currentIndex);
        if (match >= 0) selectAt(match);
        else return;
      }
    }
    event.preventDefault();
  };
}
