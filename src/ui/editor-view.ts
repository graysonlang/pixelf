import { nodeRegistry, type ParameterDefinition } from '../project/registry.js';
import type { JsonValue, PixelfProject, ProjectNode, TargetContract } from '../project/types.js';
import {
  MAX_DIMENSION,
  MIN_DIMENSION,
  parseDimension,
  scrubDimension,
  stepDimension,
} from './dimension-control.js';
import {
  createListModel,
  createPixelfLayerStackAdapter,
  pixelfNodeSummary,
  renderStructureList,
  type DensityPolicy,
} from './structure-list/index.js';

export interface TreeViewOptions {
  density: DensityPolicy;
  expanded: Set<string>;
  onDelete(nodeId: string): void;
  onMoveLayer(nodeId: string, direction: -1 | 1): void;
  onOpenActions(nodeId: string, anchor?: { x: number; y: number }): void;
  onPrimaryAction(nodeId: string): void;
  onSelect(nodeId: string): void;
  onReorderLayer(nodeId: string, anchorNodeId: string, placement: 'after' | 'before'): void;
  onToggle(nodeId: string): void;
  revision: string;
  selectedNodeId: string | null;
}

export interface PropertiesViewOptions {
  onParameter(nodeId: string, key: string, value: JsonValue): void;
  onProjectName(name: string): void;
  onTargetContract(
    nodeId: string,
    contract: TargetContract,
    options?: { preserveControls?: boolean },
  ): void;
}

export function renderProjectTree(
  container: HTMLElement,
  project: PixelfProject,
  options: TreeViewOptions,
): void {
  const snapshot = { expanded: options.expanded, project, revision: options.revision };
  const model = createListModel(
    snapshot,
    createPixelfLayerStackAdapter(),
    () => options.density.rowHeight,
  );
  renderStructureList(container, model, {
    density: options.density,
    dependencyCount: row => project.wires.filter(wire => wire.to.nodeId === row.nodeId).length,
    focusedNodeId: options.selectedNodeId,
    onDelete: options.onDelete,
    onMove: options.onMoveLayer,
    onOpenActions: options.onOpenActions,
    onPrimaryAction: options.onPrimaryAction,
    onSelect: options.onSelect,
    onReorder: options.onReorderLayer,
    onToggle: options.onToggle,
    selectedNodeId: options.selectedNodeId,
    summary: row => {
      const node = project.nodes[row.nodeId];
      return node === undefined ? row.kind : pixelfNodeSummary(project, node);
    },
  });
}

export function renderEmptyCompositeStack(container: HTMLElement): void {
  const shell = document.createElement('div');
  shell.className = 'structure-row-shell';
  shell.style.setProperty('--structure-depth', '0');
  shell.style.setProperty('--structure-row-height', '64px');
  shell.style.setProperty('--structure-thumbnail-size', '42px');
  const row = document.createElement('div');
  row.className = 'structure-chiclet kind-target';
  row.role = 'treeitem';
  row.tabIndex = 0;
  row.setAttribute('aria-label', 'Untitled composite, export bounds not set');
  row.setAttribute('aria-level', '1');
  row.setAttribute('aria-selected', 'true');
  const disclosure = document.createElement('span');
  disclosure.className = 'structure-disclosure';
  disclosure.setAttribute('aria-hidden', 'true');
  const interior = document.createElement('span');
  interior.className = 'structure-interior';
  const glyph = document.createElement('span');
  glyph.className = 'structure-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = 'C';
  const copy = document.createElement('span');
  copy.className = 'structure-copy';
  const name = document.createElement('strong');
  name.textContent = 'Untitled';
  const summary = document.createElement('span');
  summary.textContent = 'Composite / export bounds not set';
  copy.append(name, summary);
  interior.append(glyph, copy);
  row.append(disclosure, interior);
  shell.append(row);
  container.dataset.density = 'standard';
  container.replaceChildren(shell);
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
  projectName: string,
  onName: (name: string) => void,
  onContract: (contract: TargetContract, options?: { preserveControls?: boolean }) => void,
): void {
  let currentContract = node.contract;
  const nameInput = document.createElement('input');
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  nameInput.type = 'text';
  nameInput.value = projectName;
  nameInput.addEventListener('change', () => {
    const name = nameInput.value.trim();
    if (name.length === 0) {
      nameInput.value = projectName;
      return;
    }
    onName(name);
  });
  fragment.append(
    field('File name', nameInput, 'Save and Export add the selected file extension.'),
  );
  const numberField = (key: 'height' | 'width', label: string): void => {
    const wrapper = document.createElement('div');
    wrapper.className = 'property-field dimension-field';
    const name = document.createElement('label');
    name.className = 'dimension-label';
    name.textContent = label;
    name.title = `Drag to adjust ${label.toLowerCase()}`;
    const input = document.createElement('input');
    input.autocomplete = 'off';
    input.className = 'dimension-input';
    input.id = `property-${node.id}-${key}`;
    input.inputMode = 'numeric';
    input.pattern = '[0-9]*';
    input.role = 'spinbutton';
    input.type = 'text';
    input.value = String(node.contract[key]);
    input.setAttribute('aria-valuemax', String(MAX_DIMENSION));
    input.setAttribute('aria-valuemin', String(MIN_DIMENSION));
    input.setAttribute('aria-valuenow', input.value);
    name.htmlFor = input.id;
    let appliedValue = node.contract[key];
    const apply = (value: number): void => {
      if (value === appliedValue) return;
      appliedValue = value;
      input.setAttribute('aria-valuenow', String(value));
      currentContract = { ...currentContract, [key]: value };
      onContract(currentContract, { preserveControls: true });
    };
    input.addEventListener('input', () => {
      const value = parseDimension(input.value);
      if (value !== null) apply(value);
    });
    input.addEventListener('blur', () => {
      const value = parseDimension(input.value);
      if (value === null) input.value = String(appliedValue);
      else apply(value);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const current = parseDimension(input.value) ?? appliedValue;
        const value = stepDimension(current, event.key === 'ArrowUp' ? 1 : -1);
        input.value = String(value);
        apply(value);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        input.value = String(appliedValue);
        input.blur();
      }
    });
    let scrubPointerId: number | null = null;
    let scrubStartX = 0;
    let scrubStartValue = 0;
    const stopScrub = (event: PointerEvent): void => {
      if (event.pointerId !== scrubPointerId) return;
      scrubPointerId = null;
      delete wrapper.dataset.scrubbing;
      if (name.hasPointerCapture(event.pointerId)) name.releasePointerCapture(event.pointerId);
    };
    name.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      scrubPointerId = event.pointerId;
      scrubStartX = event.clientX;
      scrubStartValue = parseDimension(input.value) ?? appliedValue;
      wrapper.dataset.scrubbing = 'true';
      name.setPointerCapture(event.pointerId);
    });
    name.addEventListener('click', event => event.preventDefault());
    name.addEventListener('pointermove', event => {
      if (event.pointerId !== scrubPointerId) return;
      const value = scrubDimension(scrubStartValue, event.clientX - scrubStartX);
      input.value = String(value);
      apply(value);
    });
    name.addEventListener('pointerup', stopScrub);
    name.addEventListener('pointercancel', stopScrub);
    wrapper.append(name, input);
    fragment.append(wrapper);
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
      if (current !== undefined) {
        currentContract = { ...currentContract, [key]: current };
        onContract(currentContract);
      }
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
  eyebrow.textContent =
    node.type === 'target' ? 'Composite' : (nodeRegistry.get(node.type)?.kind ?? node.type);
  const title = document.createElement('h2');
  title.textContent = node.type === 'target' ? project.name : node.name;
  heading.append(eyebrow, title);
  fragment.append(heading);
  if (node.type === 'target') {
    targetFields(fragment, node, project.name, options.onProjectName, (contract, changeOptions) =>
      options.onTargetContract(node.id, contract, changeOptions),
    );
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
      summary.textContent = pixelfNodeSummary(project, node);
      fragment.append(summary);
    }
  }
  container.replaceChildren(fragment);
}
