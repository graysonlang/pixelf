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
  onLockChange?(nodeId: string, locked: boolean): void;
  onMove?(nodeId: string, direction: -1 | 1): void;
  onOpenActions?(nodeId: string, anchor?: { x: number; y: number }): void;
  onPrimaryAction?(nodeId: string): void;
  onReorder?(nodeId: string, anchorNodeId: string, placement: 'after' | 'before' | 'inside'): void;
  onSelect(nodeId: string): void;
  onToggle(nodeId: string): void;
  onVisibilityChange?(nodeId: string, visible: boolean): void;
  rowState?: (row: Row) => { locked: boolean; visible: boolean } | null;
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
  if (kind === 'content') return 'F';
  if (kind === 'group') return 'G';
  if (kind === 'source/mask' || kind === 'source/checker-mask') return 'M';
  if (kind.startsWith('process/')) return 'fx';
  return 'S';
}

function stateIcon(pathData: string): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('viewBox', '0 0 16 16');
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', pathData);
  icon.append(path);
  return icon;
}

function visibilityIcon(visible: boolean): SVGSVGElement {
  return stateIcon(
    visible
      ? 'M1.5 8s2.35-3.75 6.5-3.75S14.5 8 14.5 8 12.15 11.75 8 11.75 1.5 8 1.5 8zM8 6.25a1.75 1.75 0 110 3.5 1.75 1.75 0 010-3.5z'
      : 'M2.25 3l11.5 10M5.1 4.8A7.1 7.1 0 018 4.25C12.15 4.25 14.5 8 14.5 8a9.6 9.6 0 01-2.15 2.35M9.65 11.55A7.4 7.4 0 018 11.75C3.85 11.75 1.5 8 1.5 8a9.8 9.8 0 011.7-1.95M6.65 6.8a1.75 1.75 0 002.55 2.35',
  );
}

function lockIcon(locked: boolean): SVGSVGElement {
  return stateIcon(
    locked
      ? 'M4 7V5a4 4 0 018 0v2M3 7h10v7H3zM8 10v1.75'
      : 'M5 7V5a3 3 0 015.7-1.3M3 7h10v7H3zM8 10v1.75',
  );
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
      element.classList.remove('dragging', 'drop-before', 'drop-after', 'drop-inside');
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
    const rowState = options.rowState?.(row) ?? null;
    const stateDescription =
      rowState === null
        ? ''
        : `${rowState.visible ? '' : ', hidden'}${rowState.locked ? ', locked' : ''}`;
    chiclet.setAttribute('aria-label', `${row.name}${stateDescription}`);
    chiclet.setAttribute('aria-level', String(row.depth + 1));
    chiclet.setAttribute('aria-selected', String(options.selectedNodeId === row.nodeId));
    if (rowState !== null) {
      chiclet.dataset.hidden = String(!rowState.visible);
      chiclet.dataset.locked = String(rowState.locked);
    }
    const reorderable =
      (row.kind === 'filter' ||
        row.kind === 'content' ||
        row.kind === 'group' ||
        row.kind === 'layer') &&
      row.relation !== 'unary-child';
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

    if (rowState !== null) {
      const rowActions = document.createElement('span');
      rowActions.className = 'structure-row-actions';
      const lock = document.createElement('button');
      lock.className = `structure-state-button lock${rowState.locked ? ' state-active' : ''}`;
      lock.type = 'button';
      lock.dataset.testid = `structure-lock-${row.nodeId}`;
      lock.setAttribute('aria-label', `${rowState.locked ? 'Unlock' : 'Lock'} ${row.name}`);
      lock.setAttribute('aria-pressed', String(rowState.locked));
      lock.title = rowState.locked ? 'Unlock layer' : 'Lock layer';
      lock.append(lockIcon(rowState.locked));
      lock.addEventListener('click', event => {
        event.stopPropagation();
        options.onLockChange?.(row.nodeId, !rowState.locked);
      });
      const visibility = document.createElement('button');
      visibility.className = `structure-state-button visibility${
        rowState.visible ? '' : ' state-active'
      }`;
      visibility.type = 'button';
      visibility.dataset.testid = `structure-visibility-${row.nodeId}`;
      visibility.setAttribute('aria-label', `${rowState.visible ? 'Hide' : 'Show'} ${row.name}`);
      visibility.setAttribute('aria-pressed', String(!rowState.visible));
      visibility.title = rowState.visible ? 'Hide layer' : 'Show layer';
      visibility.append(visibilityIcon(rowState.visible));
      visibility.addEventListener('click', event => {
        event.stopPropagation();
        options.onVisibilityChange?.(row.nodeId, !rowState.visible);
      });
      rowActions.append(lock, visibility);
      chiclet.append(disclosure, interior, rowActions);
    } else {
      chiclet.append(disclosure, interior);
    }
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
        const relativeY = (event.clientY - bounds.top) / bounds.height;
        const placement =
          row.kind === 'group' && relativeY >= 0.25 && relativeY <= 0.75
            ? 'inside'
            : relativeY < 0.5
              ? 'before'
              : 'after';
        chiclet.classList.toggle('drop-before', placement === 'before');
        chiclet.classList.toggle('drop-after', placement === 'after');
        chiclet.classList.toggle('drop-inside', placement === 'inside');
      });
      chiclet.addEventListener('dragleave', event => {
        if (event.relatedTarget instanceof Node && chiclet.contains(event.relatedTarget)) return;
        chiclet.classList.remove('drop-before', 'drop-after', 'drop-inside');
      });
      chiclet.addEventListener('drop', event => {
        if (draggedNodeId === null || draggedNodeId === row.nodeId) return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = chiclet.getBoundingClientRect();
        const relativeY = (event.clientY - bounds.top) / bounds.height;
        const placement =
          row.kind === 'group' && relativeY >= 0.25 && relativeY <= 0.75
            ? 'inside'
            : relativeY < 0.5
              ? 'before'
              : 'after';
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
      (current?.kind === 'filter' ||
        current?.kind === 'content' ||
        current?.kind === 'group' ||
        current?.kind === 'layer') &&
      current.relation !== 'unary-child'
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
