import { nodeRegistry, type ParameterDefinition } from '../project/registry.js';
import type { JsonValue, PixelfProject, ProjectNode, TargetContract } from '../project/types.js';

export interface TreeEntry {
  depth: number;
  expandable: boolean;
  node: ProjectNode;
  parentId: string | null;
  relationship?: string;
}

export interface TreeViewOptions {
  expanded: Set<string>;
  onDelete(nodeId: string): void;
  onSelect(nodeId: string): void;
  onToggle(nodeId: string): void;
  selectedNodeId: string | null;
}

export interface PropertiesViewOptions {
  onParameter(nodeId: string, key: string, value: JsonValue): void;
  onTargetContract(nodeId: string, contract: TargetContract): void;
}

function primaryChildren(node: ProjectNode): readonly string[] {
  if (node.type === 'target') return node.childIds;
  if ('childId' in node && node.childId !== null) return [node.childId];
  return [];
}

export function projectTreeEntries(
  project: PixelfProject,
  expanded: ReadonlySet<string>,
): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const visit = (
    nodeId: string,
    depth: number,
    parentId: string | null,
    relationship?: string,
  ): void => {
    const node = project.nodes[nodeId];
    if (node === undefined) return;
    const children = primaryChildren(node);
    const wires = project.wires.filter(wire => wire.to.nodeId === node.id);
    entries.push({
      depth,
      expandable: children.length + wires.length > 0,
      node,
      parentId,
      relationship,
    });
    if (!expanded.has(node.id)) return;
    for (const childId of children) visit(childId, depth + 1, node.id);
    for (const wire of wires) {
      visit(wire.from.nodeId, depth + 1, node.id, `${wire.to.port} input`);
    }
  };
  for (const targetId of project.targetIds) visit(targetId, 0, null);
  return entries;
}

function nodeSummary(project: PixelfProject, node: ProjectNode): string {
  if (node.type === 'target') {
    return `${node.contract.width} x ${node.contract.height} / ${node.contract.workingFormat} / ${node.contract.outputFormat} ${node.contract.outputBitDepth}-bit`;
  }
  if (node.type === 'source/imported' && node.assetId !== undefined) {
    const asset = project.assets[node.assetId];
    if (asset === undefined) return 'Missing asset';
    return `${asset.width} x ${asset.height} / ${asset.storage}`;
  }
  return nodeRegistry.get(node.type)?.title ?? node.type;
}

export function renderProjectTree(
  container: HTMLElement,
  project: PixelfProject,
  options: TreeViewOptions,
): void {
  const entries = projectTreeEntries(project, options.expanded);
  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const row = document.createElement('button');
    row.className = `tree-row${entry.relationship === undefined ? '' : ' secondary'}`;
    row.dataset.nodeId = entry.node.id;
    row.setAttribute('aria-level', String(entry.depth + 1));
    row.setAttribute('aria-selected', String(options.selectedNodeId === entry.node.id));
    row.setAttribute('role', 'treeitem');
    row.style.setProperty('--tree-depth', String(entry.depth));
    row.tabIndex = options.selectedNodeId === entry.node.id ? 0 : -1;
    if (entry.expandable)
      row.setAttribute('aria-expanded', String(options.expanded.has(entry.node.id)));

    const disclosure = document.createElement('span');
    disclosure.className = 'tree-disclosure';
    disclosure.textContent = entry.expandable
      ? options.expanded.has(entry.node.id)
        ? '[-]'
        : '[+]'
      : '   ';
    disclosure.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'tree-text';
    const title = document.createElement('strong');
    title.textContent = entry.relationship
      ? `${entry.relationship}: ${entry.node.name}`
      : entry.node.name;
    const summary = document.createElement('span');
    summary.textContent = nodeSummary(project, entry.node);
    text.append(title, summary);
    row.append(disclosure, text);
    row.addEventListener('click', () => options.onSelect(entry.node.id));
    row.addEventListener('dblclick', () => {
      if (entry.expandable) options.onToggle(entry.node.id);
    });
    fragment.append(row);
  }
  container.replaceChildren(fragment);
  container.onkeydown = event => {
    const selectedIndex = entries.findIndex(entry => entry.node.id === options.selectedNodeId);
    const selectAt = (index: number): void => {
      const entry = entries[index];
      if (entry === undefined) return;
      options.onSelect(entry.node.id);
      requestAnimationFrame(() => {
        container.querySelector<HTMLElement>(`[data-node-id="${entry.node.id}"]`)?.focus();
      });
    };
    switch (event.key) {
      case 'ArrowDown':
        selectAt(Math.min(entries.length - 1, Math.max(0, selectedIndex + 1)));
        break;
      case 'ArrowUp':
        selectAt(Math.max(0, selectedIndex - 1));
        break;
      case 'Home':
        selectAt(0);
        break;
      case 'End':
        selectAt(entries.length - 1);
        break;
      case 'ArrowRight': {
        const selected = entries[selectedIndex];
        if (selected?.expandable && !options.expanded.has(selected.node.id)) {
          options.onToggle(selected.node.id);
        } else {
          selectAt(selectedIndex + 1);
        }
        break;
      }
      case 'ArrowLeft': {
        const selected = entries[selectedIndex];
        if (selected?.expandable && options.expanded.has(selected.node.id)) {
          options.onToggle(selected.node.id);
        } else if (selected?.parentId !== null && selected?.parentId !== undefined) {
          options.onSelect(selected.parentId);
        }
        break;
      }
      case 'Delete':
      case 'Backspace':
        if (options.selectedNodeId !== null) options.onDelete(options.selectedNodeId);
        break;
      case 'Enter':
      case ' ':
        if (options.selectedNodeId !== null) options.onToggle(options.selectedNodeId);
        break;
      default:
        return;
    }
    event.preventDefault();
  };
}

function field(labelText: string, control: HTMLElement, description?: string): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'property-field';
  const name = document.createElement('span');
  name.className = 'property-label';
  name.textContent = labelText;
  label.append(name, control);
  if (description !== undefined) {
    const help = document.createElement('small');
    help.textContent = description;
    label.append(help);
  }
  return label;
}

function parameterControl(
  node: ProjectNode,
  definition: ParameterDefinition,
  onValue: (value: JsonValue) => void,
): HTMLElement {
  const value = node.parameters[definition.key];
  if (definition.kind === 'boolean') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value === true;
    input.addEventListener('change', () => onValue(input.checked));
    return input;
  }
  if (definition.kind === 'enum') {
    const select = document.createElement('select');
    for (const optionValue of definition.values ?? []) {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = optionValue;
      select.append(option);
    }
    select.value = typeof value === 'string' ? value : '';
    select.addEventListener('change', () => onValue(select.value));
    return select;
  }
  const input = document.createElement('input');
  input.type = definition.kind === 'number' ? 'number' : 'text';
  input.value = String(value ?? '');
  if (definition.minimum !== undefined) input.min = String(definition.minimum);
  if (definition.maximum !== undefined) input.max = String(definition.maximum);
  input.step = definition.integer ? '1' : 'any';
  input.addEventListener('input', () => {
    if (definition.kind === 'number') {
      const numeric = Number(input.value);
      if (Number.isFinite(numeric)) onValue(numeric);
    } else onValue(input.value);
  });
  return input;
}

function targetFields(
  fragment: DocumentFragment,
  node: ProjectNode & { type: 'target' },
  onContract: (contract: TargetContract) => void,
): void {
  const numberField = (key: 'height' | 'width', label: string): void => {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '262144';
    input.step = '1';
    input.value = String(node.contract[key]);
    input.addEventListener('input', () => {
      const value = Number(input.value);
      if (Number.isInteger(value) && value > 0) onContract({ ...node.contract, [key]: value });
    });
    fragment.append(field(label, input));
  };
  const selectField = <Key extends keyof TargetContract>(
    key: Key,
    label: string,
    values: readonly TargetContract[Key][],
  ): void => {
    const select = document.createElement('select');
    for (const value of values) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = String(value);
      select.append(option);
    }
    select.value = String(node.contract[key]);
    select.addEventListener('change', () => {
      const current = values.find(value => String(value) === select.value);
      if (current !== undefined) onContract({ ...node.contract, [key]: current });
    });
    fragment.append(field(label, select));
  };
  numberField('width', 'Width');
  numberField('height', 'Height');
  selectField('workingFormat', 'Working precision', ['rgba8unorm', 'rgba16float', 'rgba32float']);
  selectField('colorSpace', 'Color space', ['srgb', 'display-p3']);
  selectField('outputFormat', 'Output format', ['png', 'jpeg', 'webp']);
  selectField('outputBitDepth', 'Output bit depth', [8, 16]);
  selectField('alphaPolicy', 'Alpha', ['preserve', 'opaque']);
}

export function renderProperties(
  container: HTMLElement,
  project: PixelfProject,
  nodeId: string | null,
  options: PropertiesViewOptions,
): void {
  const node = nodeId === null ? undefined : project.nodes[nodeId];
  if (node === undefined) {
    container.replaceChildren();
    return;
  }
  const fragment = document.createDocumentFragment();
  const heading = document.createElement('div');
  heading.className = 'properties-heading';
  const eyebrow = document.createElement('span');
  eyebrow.textContent = nodeRegistry.get(node.type)?.kind ?? node.type;
  const title = document.createElement('h2');
  title.textContent = node.name;
  heading.append(eyebrow, title);
  fragment.append(heading);
  if (node.type === 'target') {
    targetFields(fragment, node, contract => options.onTargetContract(node.id, contract));
  } else {
    const definition = nodeRegistry.get(node.type);
    for (const parameter of definition?.parameters ?? []) {
      fragment.append(
        field(
          parameter.label,
          parameterControl(node, parameter, value =>
            options.onParameter(node.id, parameter.key, value),
          ),
          parameter.description,
        ),
      );
    }
    if ((definition?.parameters.length ?? 0) === 0) {
      const summary = document.createElement('p');
      summary.className = 'properties-empty';
      summary.textContent = nodeSummary(project, node);
      fragment.append(summary);
    }
  }
  container.replaceChildren(fragment);
}
