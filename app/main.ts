import { createEffect, createRoot, createSignal, onCleanup } from 'solid-js';
import { buildInfo } from '../src/index.js';
import { decodeImageFile, type DecodedProjectImage } from '../src/browser/decode-image.js';
import { firstImageFile, isFileDrag } from '../src/browser/drop-image.js';
import { projectTargetToGraph, type DecodedImageAsset } from '../src/compositor/index.js';
import {
  artifactBytes,
  exportTargetPng,
  exportTargetWithBrowserEncoder,
  type MetadataPolicy,
} from '../src/export/index.js';
import {
  attachCanvas,
  GpuDeviceManager,
  GpuImageRenderer,
  hybridNearestBlend,
} from '../src/gpu/index.js';
import {
  createNode,
  createOpaqueId,
  createUntitledCompositeProject,
  duplicateSubtreeCommand,
  EditorState,
  findPrimaryParent,
  nodeRegistry,
  resolveTargetContract,
  serializeProject,
  type FilterLayerNode,
  type LayerNode,
  type CanvasBackground,
  type CanvasBackgroundMode,
  type ProcessorNode,
  type ProjectCommand,
  type PixelfProject,
  type SourceNode,
  type TargetContract,
  type OutputFileFormat,
} from '../src/project/index.js';
import {
  actionSupportsSurface,
  actionsForSurface,
  filterActions,
  isActionEnabled,
  isActionVisible,
  type ActionSurface,
  type UiAction,
} from '../src/ui/actions.js';
import {
  canvasBackgroundColor,
  canvasBackgroundPolarity,
  colorFromHex,
  colorToHex,
  resolvedCanvasBackground,
} from '../src/ui/canvas-background.js';
import {
  renderEmptyCompositeStack,
  renderProjectTree,
  renderProperties,
} from '../src/ui/editor-view.js';
import { historyShortcut } from '../src/ui/history-controls.js';
import { primaryShortcutLabel, shortcutLabel } from '../src/ui/platform.js';
import {
  isThemePreference,
  loadPreferences,
  savePreferences,
  type ThemePreference,
} from '../src/ui/preferences.js';
import { renderingStatusMessage } from '../src/ui/render-status.js';
import { densityPolicy, firstEnabledAction } from '../src/ui/structure-list/index.js';
import {
  actualSizeViewport,
  anchoredZoom,
  clampZoom,
  fitZoom,
  initialImageZoom,
  originalPreviewShortcut,
  panByWheel,
  pixelGridShortcut,
  wheelZoomModifier,
  wheelZoomTarget,
  zoomShortcut,
} from '../src/ui/viewport-controls.js';
import indexPath from './index.html';
import './styles.css';

export function getFilePaths(): { index: string } {
  return { index: indexPath };
}

interface SelectedImage {
  decodedAssets: Map<string, DecodedImageAsset>;
  editor: EditorState;
  original: null | {
    asset: DecodedProjectImage['asset'];
    file: File;
    url: string;
  };
}

interface PanState {
  pointerId: number;
  startPanX: number;
  startPanY: number;
  startX: number;
  startY: number;
}

interface StageSize {
  cssHeight: number;
  cssWidth: number;
  deviceHeight: number;
  deviceWidth: number;
}

type ActiveTool = 'brush' | 'eyedropper' | 'move';

type AppAction = UiAction<undefined, never, () => unknown>;

interface AppActionDefinition extends Omit<AppAction, 'invoke' | 'priority' | 'surfaces'> {
  priority?: number;
  run(): unknown;
  surfaces?: readonly ActionSurface[];
}

function appAction(definition: AppActionDefinition): AppAction {
  const { priority = 0, run, surfaces = ['quick-actions'], ...metadata } = definition;
  return {
    ...metadata,
    invoke: () => ({ effect: run, kind: 'editor' }),
    priority,
    surfaces,
  };
}

function requireElement<ElementType extends Element>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (element === null) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function normalizedContract<Contract extends TargetContract>(contract: Contract): Contract {
  if (contract.outputFormat === 'jpeg') {
    return { ...contract, alphaPolicy: 'opaque', outputBitDepth: 8 } as Contract;
  }
  if (contract.outputFormat === 'webp') return { ...contract, outputBitDepth: 8 } as Contract;
  return contract;
}

function structureFixtureProject(source: PixelfProject): PixelfProject {
  const project = structuredClone(source);
  project.name = 'Structure list fixture';
  const targetId = project.targetIds[0];
  const target = targetId === undefined ? undefined : project.nodes[targetId];
  if (target?.type !== 'target') return project;
  const baseLayer = project.nodes[target.childIds[0] ?? ''];
  if (baseLayer?.type !== 'layer' || baseLayer.childId === null) return project;
  const baseSource = project.nodes[baseLayer.childId];
  if (baseSource?.type !== 'source/imported') return project;

  target.name = 'Editorial portrait';
  target.contract = { ...target.contract, height: 400, width: 640 };
  baseLayer.name = 'Subject';
  baseSource.name = 'Portrait source';
  const levels = createNode(
    'process/levels',
    'node-fixture-levels',
    'Subject levels',
  ) as ProcessorNode;
  levels.childId = baseSource.id;
  baseLayer.childId = levels.id;

  const cleanupSource = createNode(
    'source/imported',
    'node-fixture-cleanup-source',
    'Cleanup source',
  ) as SourceNode;
  cleanupSource.assetId = baseSource.assetId;
  const cleanupLayer = createNode('layer', 'node-fixture-cleanup-layer', 'Cleanup') as LayerNode;
  cleanupLayer.childId = cleanupSource.id;

  const atmosphereSource = createNode(
    'source/imported',
    'node-fixture-atmosphere-source',
    'Atmosphere source',
  ) as SourceNode;
  atmosphereSource.assetId = baseSource.assetId;
  const blur = createNode('process/blur', 'node-fixture-blur', 'Soft focus') as ProcessorNode;
  blur.childId = atmosphereSource.id;
  const atmosphereLayer = createNode(
    'layer',
    'node-fixture-atmosphere-layer',
    'Atmosphere',
  ) as LayerNode;
  atmosphereLayer.childId = blur.id;

  const mask = createNode('source/mask', 'node-fixture-mask', 'Subject mask') as SourceNode;
  project.nodes[levels.id] = levels;
  project.nodes[cleanupSource.id] = cleanupSource;
  project.nodes[cleanupLayer.id] = cleanupLayer;
  project.nodes[atmosphereSource.id] = atmosphereSource;
  project.nodes[blur.id] = blur;
  project.nodes[atmosphereLayer.id] = atmosphereLayer;
  project.nodes[mask.id] = mask;
  target.childIds = [baseLayer.id, cleanupLayer.id, atmosphereLayer.id];
  project.wires.push({
    from: { nodeId: mask.id, port: 'mask' },
    id: 'wire-fixture-mask',
    to: { nodeId: baseLayer.id, port: 'mask' },
  });
  return project;
}

function download(data: BlobPart, mimeType: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.download = fileName;
  anchor.href = url;
  anchor.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
}

function fileNameStem(name: string): string {
  const stem = name.replace(/\.(?:pixelf|png|jpe?g|webp)$/i, '').trim();
  return stem.length > 0 ? stem : 'untitled';
}

const dispose = createRoot(disposeRoot => {
  const appShell = requireElement<HTMLElement>('.app-shell');
  const menuButton = requireElement<HTMLButtonElement>('#menu-button');
  const appMenu = requireElement<HTMLElement>('#app-menu');
  const zoomMenuButton = requireElement<HTMLButtonElement>('#zoom-menu-button');
  const zoomMenuLabel = requireElement<HTMLElement>('#zoom-menu-label');
  const zoomMenu = requireElement<HTMLElement>('#zoom-menu');
  const zoomInput = requireElement<HTMLInputElement>('#zoom-input');
  const quickActionsButton = requireElement<HTMLButtonElement>('#quick-actions-button');
  const quickActionsShortcut = requireElement<HTMLElement>('#quick-actions-shortcut');
  const quickActionsOverlay = requireElement<HTMLElement>('#quick-actions-overlay');
  const quickActionsInput = requireElement<HTMLInputElement>('#quick-actions-input');
  const quickActionsResults = requireElement<HTMLElement>('#quick-actions-results');
  const undoShortcut = requireElement<HTMLElement>('#undo-shortcut');
  const redoShortcut = requireElement<HTMLElement>('#redo-shortcut');
  const historyShortcutLabel = requireElement<HTMLElement>('#history-shortcut');
  const historyOverlay = requireElement<HTMLElement>('#history-overlay');
  const historyList = requireElement<HTMLElement>('#history-list');
  const historyCloseButton = requireElement<HTMLButtonElement>('#history-close-button');
  const settingsShortcut = requireElement<HTMLElement>('#settings-shortcut');
  const actualSizeShortcut = requireElement<HTMLElement>('#actual-size-shortcut');
  const settingsOverlay = requireElement<HTMLElement>('#settings-overlay');
  const settingsCloseButton = requireElement<HTMLButtonElement>('#settings-close-button');
  const themeInputs = Array.from(
    settingsOverlay.querySelectorAll<HTMLInputElement>('input[name="settings-theme"]'),
  );
  const input = requireElement<HTMLInputElement>('#image-input');
  const saveProjectButton = requireElement<HTMLButtonElement>('#save-project-button');
  const exportButton = requireElement<HTMLButtonElement>('#export-button');
  const exportOverlay = requireElement<HTMLElement>('#export-overlay');
  const exportPanel = requireElement<HTMLElement>('.export-panel');
  const exportForm = requireElement<HTMLFormElement>('#export-form');
  const exportFormat = requireElement<HTMLSelectElement>('#export-format');
  const metadataPolicy = requireElement<HTMLSelectElement>('#metadata-policy');
  const exportSummary = requireElement<HTMLElement>('#export-summary');
  const exportDialogStatus = requireElement<HTMLElement>('#export-dialog-status');
  const exportCloseButton = requireElement<HTMLButtonElement>('#export-close-button');
  const exportCancelButton = requireElement<HTMLButtonElement>('#export-cancel-button');
  const exportConfirmButton = requireElement<HTMLButtonElement>('#export-confirm-button');
  const preview = requireElement<HTMLImageElement>('#image-preview');
  const canvas = requireElement<HTMLCanvasElement>('#render-preview');
  const canvasFrame = requireElement<HTMLElement>('#render-preview-frame');
  const renderStatus = requireElement<HTMLElement>('#render-status');
  const layersPanel = requireElement<HTMLElement>('.layers-panel');
  const layerTree = requireElement<HTMLElement>('#layer-tree');
  const structureToolbar = requireElement<HTMLElement>('#structure-toolbar');
  const canvasProperties = requireElement<HTMLElement>('#canvas-properties');
  const selectionProperties = requireElement<HTMLElement>('#selection-properties');
  const stage = requireElement<HTMLElement>('#stage');
  const stageContent = requireElement<HTMLElement>('#stage-content');
  const addMenuButton = requireElement<HTMLButtonElement>('#add-menu-button');
  const addMenu = requireElement<HTMLElement>('#add-menu');
  const addLayerButton = requireElement<HTMLButtonElement>('#add-layer-button');
  const addFilterLayerButton = requireElement<HTMLButtonElement>('#add-filter-layer-button');
  const addMaskButton = requireElement<HTMLButtonElement>('#add-mask-button');
  const toolButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.tool-button[data-tool]'),
  );
  const fitButton = requireElement<HTMLButtonElement>('#fit-button');
  const actualSizeButton = requireElement<HTMLButtonElement>('#actual-size-button');
  const canvasBackgroundMode = requireElement<HTMLSelectElement>('#canvas-background-mode');
  const canvasBackgroundVisibility = requireElement<HTMLButtonElement>(
    '#canvas-background-visibility',
  );
  const canvasBackgroundColorRow = requireElement<HTMLElement>('#canvas-background-color-row');
  const canvasBackgroundColorInput = requireElement<HTMLInputElement>('#canvas-background-color');
  const preferences = loadPreferences(localStorage);
  const primaryShortcut = (key: string): string => primaryShortcutLabel(navigator.platform, key);
  const initialProject = createUntitledCompositeProject();
  const initialEditor = new EditorState(initialProject);
  const initialTargetId = initialProject.targetIds[0] ?? null;
  if (initialTargetId !== null) initialEditor.select([initialTargetId]);
  const [selectedImage, setSelectedImage] = createSignal<SelectedImage | null>({
    decodedAssets: new Map(),
    editor: initialEditor,
    original: null,
  });
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(initialTargetId);
  const [projectGeneration, setProjectGeneration] = createSignal(0);
  const [propertiesGeneration, setPropertiesGeneration] = createSignal(0);
  const [treeGeneration, setTreeGeneration] = createSignal(0);
  const [structureWidth, setStructureWidth] = createSignal(Math.max(1, layerTree.clientWidth));
  const [gpuMode, setGpuMode] = createSignal<'checking' | 'fallback' | 'ready'>('checking');
  const [statusMessage, setStatusMessage] = createSignal('');
  const [deviceGeneration, setDeviceGeneration] = createSignal(0);
  const [zoom, setZoom] = createSignal(1);
  const [panX, setPanX] = createSignal(0);
  const [panY, setPanY] = createSignal(0);
  const initialStageBounds = stage.getBoundingClientRect();
  const initialDeviceScale = window.devicePixelRatio || 1;
  const [stageSize, setStageSize] = createSignal<StageSize>({
    cssHeight: Math.max(1, initialStageBounds.height),
    cssWidth: Math.max(1, initialStageBounds.width),
    deviceHeight: Math.max(1, Math.round(initialStageBounds.height * initialDeviceScale)),
    deviceWidth: Math.max(1, Math.round(initialStageBounds.width * initialDeviceScale)),
  });
  const [pixelGrid, setPixelGrid] = createSignal(false);
  const [showingOriginal, setShowingOriginal] = createSignal(false);
  const [activeTool, setActiveTool] = createSignal<ActiveTool>('move');
  const [theme, setTheme] = createSignal<ThemePreference>(preferences.theme);
  const expanded = new Set<string>();
  let renderer: GpuImageRenderer | null = null;
  let selectionGeneration = 0;
  let presentationGeneration = 0;
  let dragDepth = 0;
  let panState: PanState | null = null;
  let exportDialogTargetId: string | null = null;
  let exporting = false;

  const stageResizeObserver = new ResizeObserver(entries => {
    const entry = entries.at(-1);
    const bounds = stage.getBoundingClientRect();
    const deviceBox = entry?.devicePixelContentBoxSize[0];
    const deviceScale = window.devicePixelRatio || 1;
    setStageSize({
      cssHeight: Math.max(1, bounds.height),
      cssWidth: Math.max(1, bounds.width),
      deviceHeight: Math.max(1, deviceBox?.blockSize ?? Math.round(bounds.height * deviceScale)),
      deviceWidth: Math.max(1, deviceBox?.inlineSize ?? Math.round(bounds.width * deviceScale)),
    });
  });
  try {
    stageResizeObserver.observe(stage, { box: 'device-pixel-content-box' });
  } catch {
    stageResizeObserver.observe(stage);
  }
  const structureResizeObserver = new ResizeObserver(() => {
    setStructureWidth(Math.max(1, layerTree.clientWidth));
  });
  structureResizeObserver.observe(layerTree);

  quickActionsShortcut.textContent = primaryShortcut('/');
  settingsShortcut.textContent = primaryShortcut(',');
  actualSizeShortcut.textContent = primaryShortcut('0');
  undoShortcut.textContent = primaryShortcut('Z');
  redoShortcut.textContent = shortcutLabel(['shift'], primaryShortcut('Z'));
  historyShortcutLabel.textContent = primaryShortcut('Y');

  const manager = new GpuDeviceManager({
    onContext: (context, generation) => {
      renderer?.dispose();
      renderer = new GpuImageRenderer(context);
      setGpuMode('ready');
      setDeviceGeneration(generation);
    },
    onState: state => {
      setStatusMessage(renderingStatusMessage(state));
      if (state.kind === 'unsupported' || state.kind === 'lost') setGpuMode('fallback');
    },
  });
  void manager.initialize();

  const currentEditor = (): EditorState | null => selectedImage()?.editor ?? null;
  const resolvedCurrentTarget = () => {
    const editor = currentEditor();
    const targetId = editor?.project.targetIds[0];
    const target = targetId === undefined ? undefined : editor?.project.nodes[targetId];
    return editor !== null && target?.type === 'target'
      ? resolveTargetContract(editor.project, target)
      : null;
  };
  const refreshProject = (refreshProperties = true): void => {
    setProjectGeneration(generation => generation + 1);
    if (refreshProperties) setPropertiesGeneration(generation => generation + 1);
    if (historyOverlay.classList.contains('open')) renderHistory();
  };
  const refreshTree = (): void => {
    setTreeGeneration(generation => generation + 1);
  };
  const reportError = (error: unknown): void => {
    setStatusMessage(error instanceof Error ? error.message : String(error));
  };
  const reportRenderingError = (error: unknown): void => {
    console.error('[pixelf] Preview rendering failed', error);
    setStatusMessage(
      'The edited preview could not be rendered. Pixelf is showing the source image.',
    );
  };
  const runCommand = (action: () => void, refreshProperties = true): void => {
    try {
      action();
      refreshProject(refreshProperties);
    } catch (error) {
      reportError(error);
    }
  };
  const selectNode = (nodeId: string): void => {
    currentEditor()?.select([nodeId]);
    setSelectedNodeId(nodeId);
  };
  const restoreHistorySelection = (editor: EditorState): void => {
    const selectedId = editor.selectedNodeIds.find(
      nodeId => editor.project.nodes[nodeId] !== undefined,
    );
    setSelectedNodeId(selectedId ?? null);
  };
  const toggleNode = (nodeId: string): void => {
    if (expanded.has(nodeId)) expanded.delete(nodeId);
    else expanded.add(nodeId);
    refreshTree();
  };

  const setStackItemVisibility = (nodeId: string, visible: boolean): void => {
    const editor = currentEditor();
    const node = editor?.project.nodes[nodeId];
    if (editor === null || (node?.type !== 'layer' && node?.type !== 'filter')) return;
    runCommand(() =>
      editor.dispatch(
        { nodeId, type: 'set-stack-item-visibility', visible },
        { label: visible ? 'Show layer' : 'Hide layer' },
      ),
    );
  };

  const setStackItemLocked = (nodeId: string, locked: boolean): void => {
    const editor = currentEditor();
    const node = editor?.project.nodes[nodeId];
    if (editor === null || (node?.type !== 'layer' && node?.type !== 'filter')) return;
    runCommand(() =>
      editor.dispatch(
        { locked, nodeId, type: 'set-stack-item-lock' },
        { label: locked ? 'Lock layer' : 'Unlock layer' },
      ),
    );
  };

  const targetForNode = (nodeId: string): string | null => {
    const editor = currentEditor();
    if (editor === null) return null;
    let current = editor.project.nodes[nodeId];
    while (current !== undefined && current.type !== 'target') {
      const parent = findPrimaryParent(editor.project, current.id);
      if (parent === null) return null;
      current = parent.node;
    }
    return current?.type === 'target' ? current.id : null;
  };

  const layerForNode = (nodeId: string): LayerNode | null => {
    const editor = currentEditor();
    if (editor === null) return null;
    let current = editor.project.nodes[nodeId];
    while (current !== undefined && current.type !== 'target') {
      if (current.type === 'layer') return current;
      const parent = findPrimaryParent(editor.project, current.id);
      if (parent === null) return null;
      current = parent.node;
    }
    return null;
  };

  const maskTargetForNode = (
    nodeId: string,
  ): FilterLayerNode | LayerNode | ProcessorNode | null => {
    const editor = currentEditor();
    const node = editor?.project.nodes[nodeId];
    if (node?.type === 'filter') return node;
    if (node?.type.startsWith('process/')) return node as ProcessorNode;
    return layerForNode(nodeId);
  };

  const deleteNode = (nodeId: string): void => {
    const editor = currentEditor();
    const node = editor?.project.nodes[nodeId];
    if (editor === null || node === undefined || node.type === 'target') return;
    const parent = findPrimaryParent(editor.project, nodeId);
    runCommand(() => editor.dispatch({ nodeId, type: 'remove-node' }, { label: 'Delete item' }));
    const nextSelection = parent?.node.id ?? editor.project.targetIds[0] ?? null;
    setSelectedNodeId(nextSelection);
    if (nextSelection !== null) editor.select([nextSelection]);
  };

  const addLayer = (): void => {
    const editor = currentEditor();
    if (editor === null) return;
    const targetId =
      (selectedNodeId() === null ? null : targetForNode(selectedNodeId() ?? '')) ??
      editor.project.targetIds[0];
    if (targetId === undefined || targetId === null) return;
    const target = editor.project.nodes[targetId];
    const layerNumber = target?.type === 'target' ? target.childIds.length + 1 : 1;
    const layer = createNode('layer', createOpaqueId('node'), `Layer ${layerNumber}`) as LayerNode;
    runCommand(() =>
      editor.dispatch(
        { node: layer, parentId: targetId, type: 'insert-node' },
        { label: 'Add layer' },
      ),
    );
    expanded.add(targetId);
    expanded.add(layer.id);
    selectNode(layer.id);
  };

  const addFilterLayer = (): void => {
    const editor = currentEditor();
    const selectedId = selectedNodeId();
    const targetId =
      (selectedId === null ? null : targetForNode(selectedId)) ?? editor?.project.targetIds[0];
    if (editor === null || targetId === undefined || targetId === null) return;
    const filter = createNode('filter', createOpaqueId('node')) as FilterLayerNode;
    runCommand(() =>
      editor.dispatch(
        { node: filter, parentId: targetId, type: 'insert-node' },
        { label: 'Add filter layer' },
      ),
    );
    selectNode(filter.id);
  };

  const duplicateNode = (): void => {
    const editor = currentEditor();
    const selectedId = selectedNodeId();
    if (editor === null || selectedId === null) return;
    const node = editor.project.nodes[selectedId];
    if (
      node === undefined ||
      node.type === 'target' ||
      findPrimaryParent(editor.project, node.id) === null
    ) {
      return;
    }
    runCommand(() =>
      editor.dispatch(duplicateSubtreeCommand(editor.project, node.id), {
        label: 'Duplicate branch',
      }),
    );
  };

  const addMask = (): void => {
    const editor = currentEditor();
    const selectedId = selectedNodeId();
    if (editor === null || selectedId === null) return;
    const target = maskTargetForNode(selectedId);
    if (
      target === null ||
      editor.project.wires.some(wire => wire.to.nodeId === target.id && wire.to.port === 'mask')
    ) {
      return;
    }
    const mask = createNode('source/mask', createOpaqueId('node'), 'Constant mask') as SourceNode;
    const wireId = createOpaqueId('wire');
    runCommand(() =>
      editor.dispatch(
        {
          commands: [
            { node: mask, parentId: null, type: 'insert-node' },
            {
              type: 'connect',
              wire: {
                from: { nodeId: mask.id, port: 'mask' },
                id: wireId,
                to: { nodeId: target.id, port: 'mask' },
              },
            },
          ],
          type: 'batch',
        },
        { label: 'Add mask' },
      ),
    );
    expanded.add(target.id);
    selectNode(mask.id);
  };

  const moveLayerInStack = (nodeId: string, visualDirection: -1 | 1): void => {
    const editor = currentEditor();
    const selected = editor?.project.nodes[nodeId];
    if (editor === null || (selected?.type !== 'layer' && selected?.type !== 'filter')) {
      return;
    }
    const parent = findPrimaryParent(editor.project, selected.id);
    if (parent?.node.type !== 'target') return;
    const canonicalDirection = visualDirection === -1 ? 1 : -1;
    const index = Math.max(
      0,
      Math.min(parent.node.childIds.length - 1, parent.index + canonicalDirection),
    );
    if (index === parent.index) return;
    runCommand(() =>
      editor.dispatch(
        { index, nodeId: selected.id, parentId: parent.node.id, type: 'move-node' },
        { label: 'Reorder layer' },
      ),
    );
  };

  const reorderLayerInStack = (
    nodeId: string,
    anchorNodeId: string,
    placement: 'after' | 'before',
  ): void => {
    const editor = currentEditor();
    const node = editor?.project.nodes[nodeId];
    const anchor = editor?.project.nodes[anchorNodeId];
    if (
      editor === null ||
      (node?.type !== 'layer' && node?.type !== 'filter') ||
      (anchor?.type !== 'layer' && anchor?.type !== 'filter')
    ) {
      return;
    }
    const parent = findPrimaryParent(editor.project, node.id);
    const anchorParent = findPrimaryParent(editor.project, anchor.id);
    if (
      parent?.node.type !== 'target' ||
      anchorParent?.node.type !== 'target' ||
      parent.node.id !== anchorParent.node.id
    ) {
      return;
    }
    const target = parent.node;
    const remaining = target.childIds.filter(childId => childId !== node.id);
    const anchorIndex = remaining.indexOf(anchor.id);
    if (anchorIndex < 0) return;
    const index = placement === 'before' ? anchorIndex + 1 : anchorIndex;
    const reordered = [...remaining];
    reordered.splice(index, 0, node.id);
    if (reordered.every((childId, childIndex) => target.childIds[childIndex] === childId)) {
      return;
    }
    runCommand(() =>
      editor.dispatch(
        { index, nodeId: node.id, parentId: target.id, type: 'move-node' },
        { label: 'Reorder layer' },
      ),
    );
  };

  const fitStage = (): void => {
    const selected = selectedImage();
    if (selected === null) return;
    const targetId = selected.editor.project.targetIds[0];
    const target = targetId === undefined ? undefined : selected.editor.project.nodes[targetId];
    const contract =
      target?.type === 'target' ? resolveTargetContract(selected.editor.project, target) : null;
    if (contract === null) return;
    const availableWidth = Math.max(1, stage.clientWidth - 48);
    const availableHeight = Math.max(1, stage.clientHeight - 48);
    setZoom(fitZoom(contract.width, contract.height, availableWidth, availableHeight));
    setPanX(0);
    setPanY(0);
  };

  const placeInitialImage = (): void => {
    const selected = selectedImage();
    if (selected === null) return;
    const targetId = selected.editor.project.targetIds[0];
    const target = targetId === undefined ? undefined : selected.editor.project.nodes[targetId];
    const contract =
      target?.type === 'target' ? resolveTargetContract(selected.editor.project, target) : null;
    if (contract === null) return;
    setZoom(
      initialImageZoom(contract.width, contract.height, stage.clientWidth, stage.clientHeight),
    );
    setPanX(0);
    setPanY(0);
  };

  const adoptDecodedImage = (decoded: DecodedProjectImage, file: File): void => {
    const editor = new EditorState(decoded.project);
    const targetId = decoded.project.targetIds[0] ?? null;
    expanded.clear();
    for (const nodeId of Object.keys(decoded.project.nodes)) expanded.add(nodeId);
    setSelectedImage({
      decodedAssets: new Map([[decoded.asset.id, decoded.decoded]]),
      editor,
      original: { asset: decoded.asset, file, url: URL.createObjectURL(file) },
    });
    setShowingOriginal(false);
    setSelectedNodeId(targetId);
    if (targetId !== null) editor.select([targetId]);
    setProjectGeneration(current => current + 1);
    setTreeGeneration(current => current + 1);
    requestAnimationFrame(placeInitialImage);
    setStatusMessage('');
  };

  const openImage = async (file: File): Promise<void> => {
    const generation = ++selectionGeneration;
    setStatusMessage(`Decoding ${file.name}...`);
    try {
      const decoded = await decodeImageFile(file);
      if (generation !== selectionGeneration) return;
      adoptDecodedImage(decoded, file);
    } catch (error) {
      if (generation === selectionGeneration) reportError(error);
    }
  };

  const addDroppedImageLayer = async (file: File): Promise<void> => {
    const selected = selectedImage();
    if (selected === null) {
      await openImage(file);
      return;
    }
    const generation = ++selectionGeneration;
    setStatusMessage(`Decoding ${file.name} for a new layer...`);
    try {
      const decoded = await decodeImageFile(file);
      if (generation !== selectionGeneration || selectedImage() !== selected) return;
      const targetId = selected.editor.project.targetIds[0];
      if (targetId === undefined) throw new Error('The active Composite has no target');
      const target = selected.editor.project.nodes[targetId];
      if (target?.type !== 'target') throw new Error('The active Composite target is invalid');
      const source = createNode(
        'source/imported',
        createOpaqueId('node'),
        decoded.asset.name,
      ) as SourceNode;
      source.assetId = decoded.asset.id;
      const layer = createNode('layer', createOpaqueId('node'), decoded.asset.name) as LayerNode;
      layer.childId = source.id;
      selected.decodedAssets.set(decoded.asset.id, decoded.decoded);
      try {
        const commands: ProjectCommand[] = [
          { asset: decoded.asset, type: 'insert-asset' },
          { node: source, parentId: null, type: 'insert-node' },
          { node: layer, parentId: targetId, type: 'insert-node' },
        ];
        if (target.contract.width === null || target.contract.height === null) {
          commands.push({
            contract: {
              ...target.contract,
              height: target.contract.height ?? decoded.asset.height,
              width: target.contract.width ?? decoded.asset.width,
            },
            nodeId: targetId,
            type: 'set-target-contract',
          });
        }
        selected.editor.dispatch(
          {
            commands,
            type: 'batch',
          },
          { label: 'Add image layer' },
        );
      } catch (error) {
        selected.decodedAssets.delete(decoded.asset.id);
        throw error;
      }
      expanded.add(layer.id);
      selectNode(layer.id);
      refreshProject();
      setStatusMessage('');
    } catch (error) {
      if (generation === selectionGeneration) reportError(error);
    }
  };

  const openStructureFixture = async (): Promise<void> => {
    const encoded = atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    );
    const bytes = Uint8Array.from(encoded, character => character.charCodeAt(0));
    const file = new File([bytes], 'structure-fixture.png', { type: 'image/png' });
    setStatusMessage('Preparing structure list fixture...');
    try {
      const decoded = await decodeImageFile(file);
      adoptDecodedImage({ ...decoded, project: structureFixtureProject(decoded.project) }, file);
    } catch (error) {
      reportError(error);
    }
  };

  const saveProject = (): void => {
    const editor = currentEditor();
    if (editor === null) return;
    const source = serializeProject(editor.project);
    download(source, 'application/json', `${fileNameStem(editor.project.name)}.pixelf`);
    localStorage.removeItem(`pixelf:recovery:${editor.project.projectId}`);
    editor.markSaved();
    refreshProject();
  };

  const exportTarget = async (): Promise<void> => {
    const selected = selectedImage();
    const targetId = selected?.editor.project.targetIds[0];
    if (selected === null || selected === undefined || targetId === undefined) {
      throw new Error('A composite is required before export');
    }
    const projection = projectTargetToGraph(
      selected.editor.project,
      targetId,
      selected.decodedAssets,
    );
    const policy = metadataPolicy.value as MetadataPolicy;
    const contract = normalizedContract({
      ...projection.target.contract,
      outputFormat: exportFormat.value as OutputFileFormat,
    });
    const artifact =
      contract.outputFormat === 'png'
        ? exportTargetPng(projection.graph, contract, { metadataPolicy: policy })
        : await exportTargetWithBrowserEncoder(
            projection.graph,
            contract,
            {
              encode: async (rgba, width, height, options) => {
                const exportCanvas = document.createElement('canvas');
                exportCanvas.width = width;
                exportCanvas.height = height;
                const context = exportCanvas.getContext('2d', {
                  colorSpace: options.colorSpace,
                });
                if (context === null) throw new Error('The browser export canvas is unavailable');
                const pixels = new ImageData(new Uint8ClampedArray(rgba), width, height, {
                  colorSpace: options.colorSpace,
                });
                context.putImageData(pixels, 0, 0);
                const blob = await new Promise<Blob>((resolve, reject) => {
                  exportCanvas.toBlob(
                    result =>
                      result === null
                        ? reject(new Error('Browser export failed'))
                        : resolve(result),
                    options.mimeType,
                    0.92,
                  );
                });
                return new Uint8Array(await blob.arrayBuffer());
              },
            },
            { metadataPolicy: policy },
          );
    const baseName = fileNameStem(selected.editor.project.name);
    download(
      artifactBytes(artifact) as BlobPart,
      artifact.mimeType,
      `${baseName}.${artifact.extension}`,
    );
  };

  const undo = (): void => {
    const editor = currentEditor();
    if (editor === null || !editor.undo()) return;
    restoreHistorySelection(editor);
    refreshProject();
  };
  const redo = (): void => {
    const editor = currentEditor();
    if (editor === null || !editor.redo()) return;
    restoreHistorySelection(editor);
    refreshProject();
  };
  const deleteSelected = (): void => {
    const nodeId = selectedNodeId();
    if (nodeId !== null) deleteNode(nodeId);
  };
  const setActualSize = (): void => {
    const viewport = actualSizeViewport(panX(), panY());
    setZoom(viewport.zoom);
    setPanX(viewport.panX);
    setPanY(viewport.panY);
  };
  const zoomOut = (): void => {
    setZoom(value => clampZoom(value / 1.25));
  };
  const zoomIn = (): void => {
    setZoom(value => clampZoom(value * 1.25));
  };
  const togglePixelGrid = (): void => {
    setPixelGrid(value => !value);
  };
  const toggleOriginalPreview = (): void => {
    if (selectedImage()?.original != null) setShowingOriginal(value => !value);
  };
  const currentCanvasBackground = (): CanvasBackground => {
    const editor = currentEditor();
    const targetId = editor?.project.targetIds[0];
    const target =
      editor === null || targetId === undefined ? undefined : editor.project.nodes[targetId];
    return resolvedCanvasBackground(target?.type === 'target' ? target.background : undefined);
  };
  const setCanvasBackground = (background: CanvasBackground): void => {
    const editor = currentEditor();
    const targetId = editor?.project.targetIds[0];
    if (editor === null || targetId === undefined) return;
    runCommand(() =>
      editor.dispatch(
        { background, nodeId: targetId, type: 'set-target-background' },
        { label: 'Change workspace background' },
      ),
    );
  };
  const selectedNode = () => {
    const editor = currentEditor();
    const selectedId = selectedNodeId();
    return selectedId === null ? undefined : editor?.project.nodes[selectedId];
  };
  const focusSelectionProperties = (): void => {
    const control = selectionProperties.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, button, [tabindex="0"]',
    );
    (control ?? selectionProperties).focus();
  };
  const structureSurfaces: readonly ActionSurface[] = [
    'keyboard',
    'overflow',
    'quick-actions',
    'rail',
  ];

  const actions: readonly AppAction[] = [
    appAction({
      group: 'file',
      id: 'open-image',
      keywords: ['file', 'import'],
      label: 'Open image...',
      run: () => input.click(),
      shortcut: shortcutLabel(['shift'], 'O'),
      surfaces: ['keyboard', 'menu', 'quick-actions'],
    }),
    appAction({
      enabled: () => currentEditor() !== null,
      group: 'file',
      id: 'save-project',
      keywords: ['file', 'download'],
      label: 'Save composite',
      run: saveProject,
      surfaces: ['menu', 'quick-actions'],
    }),
    appAction({
      enabled: () => resolvedCurrentTarget() !== null,
      group: 'file',
      id: 'export-target',
      keywords: ['file', 'download', 'format', 'metadata', 'render'],
      label: 'Export composite...',
      run: () => openExportDialog(),
      surfaces: ['menu', 'quick-actions'],
    }),
    appAction({
      group: 'application',
      id: 'settings',
      keywords: ['preferences', 'appearance', 'theme'],
      label: 'Settings...',
      run: () => openSettings(),
      shortcut: primaryShortcut(','),
      surfaces: ['keyboard', 'menu', 'quick-actions'],
    }),
    appAction({
      enabled: () => currentEditor()?.canUndo ?? false,
      group: 'history',
      id: 'undo',
      keywords: ['history'],
      label: 'Undo',
      run: undo,
      shortcut: primaryShortcut('Z'),
      surfaces: ['keyboard', 'menu', 'quick-actions'],
    }),
    appAction({
      enabled: () => currentEditor()?.canRedo ?? false,
      group: 'history',
      id: 'redo',
      keywords: ['history'],
      label: 'Redo',
      run: redo,
      shortcut: shortcutLabel(['shift'], primaryShortcut('Z')),
      surfaces: ['keyboard', 'menu', 'quick-actions'],
    }),
    appAction({
      enabled: () => currentEditor() !== null,
      group: 'history',
      id: 'history',
      keywords: ['changes', 'states', 'time travel'],
      label: 'History...',
      run: () => openHistory(),
      shortcut: primaryShortcut('Y'),
      surfaces: ['keyboard', 'menu', 'quick-actions'],
    }),
    appAction({
      enabled: () => currentEditor() !== null,
      group: 'structure',
      id: 'add-layer',
      keywords: ['new', 'source'],
      label: 'Add layer',
      priority: 70,
      run: addLayer,
      surfaces: structureSurfaces,
    }),
    appAction({
      enabled: () => currentEditor() !== null,
      group: 'structure',
      id: 'add-filter-layer',
      keywords: ['new', 'adjustment', 'effect', 'blur', 'clarity'],
      label: 'Add filter layer',
      priority: 65,
      run: addFilterLayer,
      surfaces: structureSurfaces,
    }),
    appAction({
      enabled: () => {
        const editor = currentEditor();
        const selectedId = selectedNodeId();
        if (editor === null || selectedId === null) return false;
        const target = maskTargetForNode(selectedId);
        return (
          target !== null &&
          !editor.project.wires.some(
            wire => wire.to.nodeId === target.id && wire.to.port === 'mask',
          )
        );
      },
      group: 'structure',
      id: 'add-mask',
      keywords: ['new', 'layer'],
      label: 'Add mask',
      priority: 60,
      run: addMask,
      surfaces: structureSurfaces,
    }),
    appAction({
      enabled: () => {
        const editor = currentEditor();
        const node = selectedNode();
        return (
          editor !== null &&
          node !== undefined &&
          node.type !== 'target' &&
          findPrimaryParent(editor.project, node.id) !== null
        );
      },
      group: 'structure',
      id: 'duplicate',
      keywords: ['copy', 'branch'],
      label: 'Duplicate selected branch',
      priority: 30,
      run: duplicateNode,
      surfaces: [...structureSurfaces, 'context'],
    }),
    appAction({
      enabled: () => {
        const editor = currentEditor();
        const node = selectedNode();
        return (
          editor !== null &&
          node !== undefined &&
          node.type !== 'target' &&
          findPrimaryParent(editor.project, node.id) !== null
        );
      },
      group: 'structure',
      id: 'delete',
      keywords: ['remove', 'selected'],
      label: 'Delete selected item',
      priority: 10,
      run: deleteSelected,
      surfaces: [...structureSurfaces, 'context'],
    }),
    appAction({
      enabled: () => selectedNodeId() !== null,
      group: 'structure',
      id: 'show-properties',
      keywords: ['inspect', 'edit'],
      label: 'Show properties',
      priority: 100,
      run: focusSelectionProperties,
      surfaces: ['context', 'keyboard', 'overflow', 'rail'],
    }),
    appAction({
      enabled: () => resolvedCurrentTarget() !== null,
      group: 'view',
      id: 'fit-preview',
      keywords: ['zoom', 'view'],
      label: 'Fit preview',
      run: fitStage,
      surfaces: ['keyboard', 'quick-actions'],
    }),
    appAction({
      group: 'view',
      id: 'actual-size',
      keywords: ['zoom', 'view', '100 percent'],
      label: 'Preview at 100%',
      run: setActualSize,
      shortcut: primaryShortcut('0'),
      surfaces: ['keyboard', 'quick-actions'],
    }),
    appAction({
      group: 'view',
      id: 'zoom-in',
      keywords: ['view', 'preview'],
      label: 'Zoom in',
      run: zoomIn,
      surfaces: ['keyboard', 'quick-actions'],
    }),
    appAction({
      group: 'view',
      id: 'zoom-out',
      keywords: ['view', 'preview'],
      label: 'Zoom out',
      run: zoomOut,
      surfaces: ['keyboard', 'quick-actions'],
    }),
    appAction({
      enabled: () => selectedImage()?.original != null,
      group: 'view',
      id: 'original-preview',
      keywords: ['before', 'after', 'compare', 'source', 'view'],
      label: 'Toggle original / edited',
      run: toggleOriginalPreview,
      shortcut: '\\',
      surfaces: ['keyboard', 'quick-actions'],
    }),
    appAction({
      group: 'view',
      id: 'pixel-grid',
      keywords: ['toggle', 'view'],
      label: 'Toggle pixel grid',
      run: togglePixelGrid,
      shortcut: primaryShortcut("'"),
      surfaces: ['keyboard', 'quick-actions'],
    }),
  ];
  const actionsById = new Map(actions.map(action => [action.id, action]));
  const menuActionButtons = Array.from(
    appMenu.querySelectorAll<HTMLButtonElement>('button[data-action]'),
  );
  let filteredQuickActions: readonly AppAction[] = actionsForSurface(
    actions,
    'quick-actions',
    undefined,
  );
  let quickActionFocus = 0;
  let structureToolbarOwnerId: string | null = null;

  const setAddMenuOpen = (open: boolean, restoreFocus = false): void => {
    if (open) {
      addMenu.hidden = false;
      const buttonBounds = addMenuButton.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(
          window.innerWidth - addMenu.offsetWidth - 8,
          buttonBounds.right - addMenu.offsetWidth,
        ),
      );
      const top = Math.max(8, buttonBounds.top - addMenu.offsetHeight - 6);
      addMenu.style.left = `${left}px`;
      addMenu.style.top = `${top}px`;
    } else addMenu.hidden = true;
    addMenuButton.setAttribute('aria-expanded', String(open));
    if (!open && restoreFocus) addMenuButton.focus();
  };
  const setZoomMenuOpen = (open: boolean, restoreFocus = false): void => {
    if (open) {
      setAddMenuOpen(false);
      zoomMenu.hidden = false;
      const buttonBounds = zoomMenuButton.getBoundingClientRect();
      const menuWidth = zoomMenu.offsetWidth;
      zoomMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - menuWidth - 8, buttonBounds.left))}px`;
      zoomMenu.style.top = `${Math.max(8, buttonBounds.top - zoomMenu.offsetHeight - 6)}px`;
      zoomInput.value = String(Math.round(zoom() * 100));
    }
    zoomMenu.hidden = !open;
    zoomMenuButton.setAttribute('aria-expanded', String(open));
    if (!open && restoreFocus) zoomMenuButton.focus();
  };
  const setMenuOpen = (open: boolean, focusFirst = false): void => {
    if (open) {
      setAddMenuOpen(false);
      setZoomMenuOpen(false);
    }
    appMenu.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    if (open && focusFirst) {
      menuActionButtons.find(button => !button.disabled)?.focus();
    }
  };
  const syncMenuActions = (): void => {
    for (const button of menuActionButtons) {
      const action = actionsById.get(button.dataset.action ?? '');
      button.disabled =
        action === undefined ||
        !actionSupportsSurface(action, 'menu') ||
        !isActionVisible(action, undefined) ||
        !isActionEnabled(action, undefined);
    }
  };
  const setQuickActionFocus = (index: number): void => {
    quickActionFocus = index;
    const buttons = quickActionsResults.querySelectorAll<HTMLButtonElement>('.quick-action');
    buttons.forEach((button, buttonIndex) => {
      button.classList.toggle('focused', buttonIndex === index);
    });
  };
  const executeAction = (action: AppAction): void => {
    if (!isActionVisible(action, undefined) || !isActionEnabled(action, undefined)) return;
    closeQuickActions();
    closeStructureToolbar(false);
    setMenuOpen(false);
    setAddMenuOpen(false);
    setZoomMenuOpen(false);
    try {
      const result = action.invoke(undefined);
      if (result.kind === 'command') {
        throw new Error(`App action ${action.id} returned an unsupported document command`);
      }
      void Promise.resolve(result.effect()).catch(reportError);
    } catch (error) {
      reportError(error);
    }
  };
  function focusStructureRow(nodeId: string): void {
    const rows = layerTree.querySelectorAll<HTMLElement>('[role="treeitem"]');
    for (const row of rows) {
      if (row.dataset.nodeId === nodeId) {
        row.focus();
        return;
      }
    }
  }
  function closeStructureToolbar(restoreFocus: boolean): void {
    const ownerId = structureToolbarOwnerId;
    structureToolbar.hidden = true;
    structureToolbar.replaceChildren();
    structureToolbarOwnerId = null;
    if (restoreFocus && ownerId !== null) focusStructureRow(ownerId);
  }
  function openStructureToolbar(nodeId: string, anchor?: { x: number; y: number }): void {
    structureToolbarOwnerId = nodeId;
    const label = document.createElement('span');
    label.className = 'structure-toolbar-label';
    const actionNode = currentEditor()?.project.nodes[nodeId];
    label.textContent =
      actionNode?.type === 'target'
        ? (currentEditor()?.project.name ?? 'Composite')
        : (actionNode?.name ?? 'Selected item');
    const contextActions = actionsForSurface(actions, 'context', undefined)
      .slice()
      .sort((left, right) => right.priority - left.priority);
    const buttons: HTMLButtonElement[] = [];
    const fragment = document.createDocumentFragment();
    fragment.append(label);
    for (const action of contextActions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.role = 'menuitem';
      button.dataset.action = action.id;
      button.dataset.testid = `structure-action-${action.id}`;
      button.disabled = !isActionEnabled(action, undefined);
      button.textContent = action.label;
      button.addEventListener('click', () => executeAction(action));
      buttons.push(button);
      fragment.append(button);
    }
    structureToolbar.replaceChildren(fragment);
    structureToolbar.hidden = false;
    const preferredY = anchor?.y ?? window.innerHeight / 2;
    const panelBounds = layersPanel.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(
        window.innerWidth - structureToolbar.offsetWidth - 8,
        panelBounds.left - structureToolbar.offsetWidth - 6,
      ),
    );
    const top = Math.max(
      8,
      Math.min(window.innerHeight - structureToolbar.offsetHeight - 8, preferredY + 4),
    );
    structureToolbar.style.left = `${left}px`;
    structureToolbar.style.top = `${top}px`;
    const first = firstEnabledAction(contextActions, undefined);
    buttons.find(button => button.dataset.action === first?.id)?.focus();
  }
  const executeActionById = (id: string, surface: ActionSurface): void => {
    const action = actionsById.get(id);
    if (action !== undefined && actionSupportsSurface(action, surface)) executeAction(action);
  };
  const renderQuickActions = (query: string): void => {
    filteredQuickActions = filterActions(
      actionsForSurface(actions, 'quick-actions', undefined),
      query,
    );
    quickActionsResults.replaceChildren();
    if (filteredQuickActions.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'quick-actions-empty';
      empty.textContent = 'No actions found';
      quickActionsResults.append(empty);
      quickActionFocus = -1;
      return;
    }
    quickActionFocus = filteredQuickActions.findIndex(action => isActionEnabled(action, undefined));
    filteredQuickActions.forEach((action, index) => {
      const button = document.createElement('button');
      button.className = `quick-action${index === quickActionFocus ? ' focused' : ''}`;
      button.type = 'button';
      button.disabled = !isActionEnabled(action, undefined);
      const label = document.createElement('span');
      label.textContent = action.label;
      button.append(label);
      if (action.shortcut !== undefined) {
        const shortcut = document.createElement('kbd');
        shortcut.textContent = action.shortcut;
        button.append(shortcut);
      }
      button.addEventListener('mouseenter', () => {
        if (!button.disabled) setQuickActionFocus(index);
      });
      button.addEventListener('click', () => executeAction(action));
      quickActionsResults.append(button);
    });
  };
  function closeQuickActions(restoreFocus = false): void {
    if (!quickActionsOverlay.classList.contains('open')) return;
    quickActionsOverlay.classList.remove('open');
    quickActionsOverlay.setAttribute('aria-hidden', 'true');
    quickActionsOverlay.inert = true;
    if (restoreFocus) menuButton.focus();
  }
  const openQuickActions = (): void => {
    setMenuOpen(false);
    setAddMenuOpen(false);
    setZoomMenuOpen(false);
    quickActionsInput.value = '';
    renderQuickActions('');
    quickActionsOverlay.inert = false;
    quickActionsOverlay.setAttribute('aria-hidden', 'false');
    quickActionsOverlay.classList.add('open');
    requestAnimationFrame(() => quickActionsInput.focus());
  };
  const historyTimeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  function focusCurrentHistory(): void {
    const current = historyList.querySelector<HTMLButtonElement>(
      '.history-entry[aria-current="step"]',
    );
    current?.focus({ preventScroll: true });
    current?.scrollIntoView({ block: 'nearest' });
  }
  function renderHistory(): void {
    const editor = currentEditor();
    const fragment = document.createDocumentFragment();
    for (const item of [...(editor?.history ?? [])].reverse()) {
      const button = document.createElement('button');
      button.className = 'history-entry';
      button.dataset.historyId = String(item.id);
      button.dataset.position = item.position;
      button.dataset.testid = `history-state-${item.id}`;
      button.type = 'button';
      if (item.position === 'current') button.setAttribute('aria-current', 'step');

      const label = document.createElement('span');
      label.className = 'history-entry-label';
      label.textContent = item.label;
      const meta = document.createElement('span');
      meta.className = 'history-entry-meta';
      const time = document.createElement('time');
      const date = new Date(item.time);
      time.dateTime = date.toISOString();
      time.textContent = historyTimeFormatter.format(date);
      meta.append(time);
      const statusText =
        item.position === 'current' ? 'Current' : item.position === 'future' ? 'Undone' : null;
      for (const status of [item.saved ? 'Saved' : null, statusText]) {
        if (status === null) continue;
        const badge = document.createElement('span');
        badge.className = 'history-entry-status';
        badge.textContent = status;
        meta.append(badge);
      }
      button.append(label, meta);
      button.addEventListener('click', () => {
        const activeEditor = currentEditor();
        if (activeEditor === null || item.id === activeEditor.currentHistoryId) return;
        if (!activeEditor.goToHistoryState(item.id)) return;
        restoreHistorySelection(activeEditor);
        refreshProject();
        requestAnimationFrame(focusCurrentHistory);
      });
      fragment.append(button);
    }
    historyList.replaceChildren(fragment);
  }
  function closeHistory(restoreFocus = false): void {
    if (!historyOverlay.classList.contains('open')) return;
    historyOverlay.classList.remove('open');
    historyOverlay.setAttribute('aria-hidden', 'true');
    historyOverlay.inert = true;
    appShell.inert = false;
    if (restoreFocus) menuButton.focus();
  }
  function openHistory(): void {
    if (currentEditor() === null) return;
    closeQuickActions();
    closeExportDialog();
    closeSettings();
    setMenuOpen(false);
    setAddMenuOpen(false);
    setZoomMenuOpen(false);
    renderHistory();
    appShell.inert = true;
    historyOverlay.inert = false;
    historyOverlay.setAttribute('aria-hidden', 'false');
    historyOverlay.classList.add('open');
    requestAnimationFrame(focusCurrentHistory);
  }
  const updateExportSummary = (): void => {
    const selected = selectedImage();
    const targetId = selected?.editor.project.targetIds[0];
    const target = targetId === undefined ? undefined : selected?.editor.project.nodes[targetId];
    if (selected === null || target?.type !== 'target') {
      exportSummary.textContent = '';
      return;
    }
    const resolved = resolveTargetContract(selected.editor.project, target);
    if (resolved === null) {
      exportSummary.textContent = '';
      return;
    }
    const contract = normalizedContract({
      ...resolved,
      outputFormat: exportFormat.value as OutputFileFormat,
    });
    const colorSpace = contract.colorSpace === 'display-p3' ? 'Display P3' : 'sRGB';
    const alpha = contract.alphaPolicy === 'preserve' ? 'transparency preserved' : 'opaque';
    exportSummary.textContent = `${contract.width} x ${contract.height}, ${contract.outputBitDepth}-bit, ${colorSpace}, ${alpha}`;
  };
  const setExportBusy = (busy: boolean): void => {
    exporting = busy;
    exportPanel.setAttribute('aria-busy', String(busy));
    exportFormat.disabled = busy;
    metadataPolicy.disabled = busy;
    exportCloseButton.disabled = busy;
    exportCancelButton.disabled = busy;
    exportConfirmButton.disabled = busy;
    exportConfirmButton.textContent = busy ? 'Exporting...' : 'Export';
  };
  function closeExportDialog(restoreFocus = false): void {
    if (exporting || !exportOverlay.classList.contains('open')) return;
    exportOverlay.classList.remove('open');
    exportOverlay.setAttribute('aria-hidden', 'true');
    exportOverlay.inert = true;
    appShell.inert = false;
    if (restoreFocus) menuButton.focus();
  }
  function openExportDialog(): void {
    const selected = selectedImage();
    const targetId = selected?.editor.project.targetIds[0];
    const target = targetId === undefined ? undefined : selected?.editor.project.nodes[targetId];
    if (selected === null || target?.type !== 'target') return;
    if (resolveTargetContract(selected.editor.project, target) === null) return;
    closeQuickActions();
    closeHistory();
    closeSettings();
    setMenuOpen(false);
    setAddMenuOpen(false);
    setZoomMenuOpen(false);
    if (exportDialogTargetId !== target.id) {
      exportFormat.value = target.contract.outputFormat;
      exportDialogTargetId = target.id;
    }
    setExportBusy(false);
    exportDialogStatus.textContent = '';
    exportDialogStatus.hidden = true;
    updateExportSummary();
    appShell.inert = true;
    exportOverlay.inert = false;
    exportOverlay.setAttribute('aria-hidden', 'false');
    exportOverlay.classList.add('open');
    requestAnimationFrame(() => exportFormat.focus());
  }
  function closeSettings(restoreFocus = false): void {
    if (!settingsOverlay.classList.contains('open')) return;
    settingsOverlay.classList.remove('open');
    settingsOverlay.setAttribute('aria-hidden', 'true');
    settingsOverlay.inert = true;
    if (restoreFocus) menuButton.focus();
  }
  function openSettings(): void {
    closeQuickActions();
    closeExportDialog();
    closeHistory();
    setMenuOpen(false);
    setAddMenuOpen(false);
    setZoomMenuOpen(false);
    for (const themeInput of themeInputs) themeInput.checked = themeInput.value === theme();
    settingsOverlay.inert = false;
    settingsOverlay.setAttribute('aria-hidden', 'false');
    settingsOverlay.classList.add('open');
    requestAnimationFrame(() => themeInputs.find(themeInput => themeInput.checked)?.focus());
  }
  const moveQuickActionFocus = (direction: -1 | 1): void => {
    if (filteredQuickActions.length === 0) return;
    let next = quickActionFocus;
    for (let offset = 0; offset < filteredQuickActions.length; offset += 1) {
      next = (next + direction + filteredQuickActions.length) % filteredQuickActions.length;
      const action = filteredQuickActions[next];
      if (action !== undefined && isActionEnabled(action, undefined)) {
        setQuickActionFocus(next);
        return;
      }
    }
  };

  const onInputChange = (): void => {
    const file = input.files?.[0];
    input.value = '';
    if (file !== undefined) void openImage(file);
  };
  const onToolButtonClick = (event: MouseEvent): void => {
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement)) return;
    const tool = button.dataset.tool;
    if (tool === 'move' || tool === 'brush' || tool === 'eyedropper') setActiveTool(tool);
  };
  const resetDropTarget = (): void => {
    dragDepth = 0;
    appShell.classList.remove('drop-target');
  };
  const onDragEnter = (event: DragEvent): void => {
    if (!isFileDrag(event.dataTransfer?.types ?? [])) return;
    event.preventDefault();
    dragDepth += 1;
    appShell.classList.add('drop-target');
    setStatusMessage(selectedImage() === null ? 'Drop image to open' : 'Drop image to add a layer');
  };
  const onDragOver = (event: DragEvent): void => {
    if (!isFileDrag(event.dataTransfer?.types ?? [])) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (event: DragEvent): void => {
    if (!isFileDrag(event.dataTransfer?.types ?? []) && dragDepth === 0) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth > 0) return;
    appShell.classList.remove('drop-target');
    setStatusMessage('');
  };
  const onDrop = (event: DragEvent): void => {
    if (
      !isFileDrag(event.dataTransfer?.types ?? []) &&
      (event.dataTransfer?.files.length ?? 0) === 0
    ) {
      return;
    }
    event.preventDefault();
    resetDropTarget();
    const file = firstImageFile(event.dataTransfer?.files ?? []);
    if (file === null) {
      setStatusMessage('The dropped files do not include a supported image');
      return;
    }
    void addDroppedImageLayer(file);
  };
  const applyCustomZoom = (): void => {
    if (zoomInput.value.trim().length === 0) return;
    const percentage = Number(zoomInput.value);
    if (!Number.isFinite(percentage)) return;
    setZoom(clampZoom(percentage / 100));
  };
  const onAddMenuButtonClick = (): void => {
    setMenuOpen(false);
    setZoomMenuOpen(false);
    setAddMenuOpen(addMenu.hidden);
  };
  const onAddMenuButtonKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    setMenuOpen(false);
    setZoomMenuOpen(false);
    setAddMenuOpen(true);
    addMenu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  };
  const onAddMenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setAddMenuOpen(false, true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(
      addMenu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    );
    if (buttons.length === 0) return;
    event.preventDefault();
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = buttons.length - 1;
    else {
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      nextIndex = (Math.max(0, currentIndex) + direction + buttons.length) % buttons.length;
    }
    buttons[nextIndex]?.focus();
  };
  const onAddLayerButtonClick = (): void => {
    setAddMenuOpen(false);
    addLayer();
  };
  const onAddFilterLayerButtonClick = (): void => {
    setAddMenuOpen(false);
    addFilterLayer();
  };
  const onAddMaskButtonClick = (): void => {
    setAddMenuOpen(false);
    addMask();
  };
  const onZoomMenuButtonClick = (): void => {
    setMenuOpen(false);
    setZoomMenuOpen(zoomMenu.hidden);
  };
  const onZoomMenuButtonKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    setMenuOpen(false);
    setZoomMenuOpen(true);
    fitButton.focus();
  };
  const onFitButtonClick = (): void => {
    fitStage();
    setZoomMenuOpen(false, true);
  };
  const onActualSizeButtonClick = (): void => {
    setActualSize();
    setZoomMenuOpen(false, true);
  };
  const onZoomInput = (): void => applyCustomZoom();
  const onZoomInputChange = (): void => {
    applyCustomZoom();
    zoomInput.value = String(Math.round(zoom() * 100));
  };
  const onZoomInputKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyCustomZoom();
      setZoomMenuOpen(false, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setZoomMenuOpen(false, true);
    }
  };
  const onWindowResize = (): void => {
    if (!zoomMenu.hidden) setZoomMenuOpen(true);
    if (!addMenu.hidden) setAddMenuOpen(true);
  };
  const onStageWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (selectedImage() === null) return;
    if (!wheelZoomModifier(event)) {
      const result = panByWheel(panX(), panY(), event.deltaX, event.deltaY);
      setPanX(result.panX);
      setPanY(result.panY);
      return;
    }
    const bounds = stage.getBoundingClientRect();
    const anchorX = event.clientX - bounds.left - bounds.width / 2;
    const anchorY = event.clientY - bounds.top - bounds.height / 2;
    const result = anchoredZoom(
      zoom(),
      wheelZoomTarget(zoom(), event.deltaY),
      panX(),
      panY(),
      anchorX,
      anchorY,
    );
    setZoom(result.zoom);
    setPanX(result.panX);
    setPanY(result.panY);
  };
  const onCanvasBackgroundModeChange = (): void => {
    const background = currentCanvasBackground();
    const mode = canvasBackgroundMode.value as CanvasBackgroundMode;
    setCanvasBackground({
      ...background,
      color:
        mode === 'custom' ? (background.color ?? { a: 1, b: 1, g: 1, r: 1 }) : background.color,
      mode,
    });
  };
  const onCanvasBackgroundVisibilityClick = (): void => {
    const background = currentCanvasBackground();
    setCanvasBackground({ ...background, visible: !background.visible });
  };
  const onCanvasBackgroundColorChange = (): void => {
    setCanvasBackground({
      ...currentCanvasBackground(),
      color: colorFromHex(canvasBackgroundColorInput.value),
      mode: 'custom',
    });
  };
  const onMenuButtonClick = (): void => {
    syncMenuActions();
    setMenuOpen(appMenu.hidden);
  };
  const onMenuButtonKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    syncMenuActions();
    setMenuOpen(true, true);
  };
  const onAppMenuClick = (event: MouseEvent): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    if (button === null || !appMenu.contains(button)) return;
    const action = actionsById.get(button.dataset.action ?? '');
    if (action !== undefined && actionSupportsSurface(action, 'menu')) executeAction(action);
  };
  const onAppMenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setMenuOpen(false);
      menuButton.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = menuActionButtons.filter(button => !button.disabled);
    if (buttons.length === 0) return;
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (currentIndex + direction + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  };
  const onQuickActionsButtonClick = (): void => openQuickActions();
  const onQuickActionsInput = (): void => renderQuickActions(quickActionsInput.value);
  const onQuickActionsInputKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveQuickActionFocus(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const action = filteredQuickActions[quickActionFocus];
      if (action !== undefined) executeAction(action);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeQuickActions(true);
    }
  };
  const onQuickActionsOverlayPointerDown = (event: PointerEvent): void => {
    if (event.target === quickActionsOverlay) closeQuickActions(true);
  };
  const onExportOverlayPointerDown = (event: PointerEvent): void => {
    if (event.target === exportOverlay) closeExportDialog(true);
  };
  const onExportCloseButtonClick = (): void => closeExportDialog(true);
  const onExportCancelButtonClick = (): void => closeExportDialog(true);
  const onExportFormatChange = (): void => updateExportSummary();
  const onExportFormSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    if (exporting) return;
    setExportBusy(true);
    exportDialogStatus.textContent = '';
    exportDialogStatus.hidden = true;
    void exportTarget()
      .then(() => {
        setExportBusy(false);
        closeExportDialog(true);
      })
      .catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        setExportBusy(false);
        exportDialogStatus.textContent = message;
        exportDialogStatus.hidden = false;
        reportError(error);
      });
  };
  const onSettingsOverlayPointerDown = (event: PointerEvent): void => {
    if (event.target === settingsOverlay) closeSettings(true);
  };
  const onSettingsCloseButtonClick = (): void => closeSettings(true);
  const onHistoryOverlayPointerDown = (event: PointerEvent): void => {
    if (event.target === historyOverlay) closeHistory(true);
  };
  const onHistoryCloseButtonClick = (): void => closeHistory(true);
  const onHistoryListKeyDown = (event: KeyboardEvent): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const entries = Array.from(historyList.querySelectorAll<HTMLButtonElement>('.history-entry'));
    if (entries.length === 0) return;
    event.preventDefault();
    const currentIndex = entries.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = entries.length - 1;
    else {
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      nextIndex = (Math.max(0, currentIndex) + direction + entries.length) % entries.length;
    }
    entries[nextIndex]?.focus();
  };
  const onSettingsChange = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.name !== 'settings-theme') return;
    if (input.checked && isThemePreference(input.value)) setTheme(input.value);
  };
  const onStructureToolbarKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeStructureToolbar(true);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(
      structureToolbar.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    );
    if (buttons.length === 0) return;
    event.preventDefault();
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = buttons.length - 1;
    else {
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      nextIndex = (Math.max(0, currentIndex) + direction + buttons.length) % buttons.length;
    }
    buttons[nextIndex]?.focus();
  };
  const onDocumentPointerDown = (event: PointerEvent): void => {
    const target = event.target as Node;
    if (!appMenu.hidden && !appMenu.contains(target) && !menuButton.contains(target)) {
      setMenuOpen(false);
    }
    if (!zoomMenu.hidden && !zoomMenu.contains(target) && !zoomMenuButton.contains(target)) {
      setZoomMenuOpen(false);
    }
    if (!addMenu.hidden && !addMenu.contains(target) && !addMenuButton.contains(target)) {
      setAddMenuOpen(false);
    }
    if (
      !structureToolbar.hidden &&
      !structureToolbar.contains(target) &&
      !layerTree.contains(target)
    ) {
      closeStructureToolbar(false);
    }
  };
  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (exportOverlay.classList.contains('open')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeExportDialog(true);
      }
      return;
    }
    if (settingsOverlay.classList.contains('open')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSettings(true);
      }
      return;
    }
    if (historyOverlay.classList.contains('open')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeHistory(true);
        return;
      }
      const shortcut = historyShortcut(event);
      if (shortcut !== null) {
        event.preventDefault();
        if (shortcut === 'open') closeHistory(true);
        else {
          executeActionById(shortcut, 'keyboard');
          requestAnimationFrame(focusCurrentHistory);
        }
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === '/') {
      event.preventDefault();
      if (quickActionsOverlay.classList.contains('open')) closeQuickActions(true);
      else openQuickActions();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === ',') {
      event.preventDefault();
      executeActionById('settings', 'keyboard');
      return;
    }
    if (event.key === 'Escape') {
      if (!appMenu.hidden) {
        setMenuOpen(false);
        menuButton.focus();
      }
      if (!zoomMenu.hidden) setZoomMenuOpen(false, true);
      if (!addMenu.hidden) setAddMenuOpen(false, true);
      return;
    }
    if (quickActionsOverlay.classList.contains('open')) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    const historyAction = historyShortcut(event);
    if (historyAction !== null) {
      event.preventDefault();
      executeActionById(historyAction === 'open' ? 'history' : historyAction, 'keyboard');
      return;
    }
    if (pixelGridShortcut(event)) {
      event.preventDefault();
      executeActionById('pixel-grid', 'keyboard');
      return;
    }
    if (originalPreviewShortcut(event)) {
      event.preventDefault();
      if (!event.repeat) executeActionById('original-preview', 'keyboard');
      return;
    }
    if (
      event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.code === 'KeyO'
    ) {
      event.preventDefault();
      executeActionById('open-image', 'keyboard');
      return;
    }
    const shortcut = zoomShortcut(event);
    if (shortcut === null) return;
    event.preventDefault();
    if (shortcut === 'fit') executeActionById('fit-preview', 'keyboard');
    else if (shortcut === 'reset') executeActionById('actual-size', 'keyboard');
    else if (shortcut === 'in') executeActionById('zoom-in', 'keyboard');
    else executeActionById('zoom-out', 'keyboard');
  };
  const onZoomMenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setZoomMenuOpen(false, true);
    }
  };
  input.addEventListener('change', onInputChange);
  appShell.addEventListener('dragenter', onDragEnter);
  appShell.addEventListener('dragover', onDragOver);
  appShell.addEventListener('dragleave', onDragLeave);
  appShell.addEventListener('drop', onDrop);
  menuButton.addEventListener('click', onMenuButtonClick);
  menuButton.addEventListener('keydown', onMenuButtonKeyDown);
  addMenuButton.addEventListener('click', onAddMenuButtonClick);
  addMenuButton.addEventListener('keydown', onAddMenuButtonKeyDown);
  addMenu.addEventListener('keydown', onAddMenuKeyDown);
  zoomMenuButton.addEventListener('click', onZoomMenuButtonClick);
  zoomMenuButton.addEventListener('keydown', onZoomMenuButtonKeyDown);
  zoomMenu.addEventListener('keydown', onZoomMenuKeyDown);
  zoomInput.addEventListener('input', onZoomInput);
  zoomInput.addEventListener('change', onZoomInputChange);
  zoomInput.addEventListener('keydown', onZoomInputKeyDown);
  window.addEventListener('resize', onWindowResize);
  appMenu.addEventListener('click', onAppMenuClick);
  appMenu.addEventListener('keydown', onAppMenuKeyDown);
  quickActionsButton.addEventListener('click', onQuickActionsButtonClick);
  quickActionsInput.addEventListener('input', onQuickActionsInput);
  quickActionsInput.addEventListener('keydown', onQuickActionsInputKeyDown);
  quickActionsOverlay.addEventListener('pointerdown', onQuickActionsOverlayPointerDown);
  historyOverlay.addEventListener('pointerdown', onHistoryOverlayPointerDown);
  historyCloseButton.addEventListener('click', onHistoryCloseButtonClick);
  historyList.addEventListener('keydown', onHistoryListKeyDown);
  exportOverlay.addEventListener('pointerdown', onExportOverlayPointerDown);
  exportCloseButton.addEventListener('click', onExportCloseButtonClick);
  exportCancelButton.addEventListener('click', onExportCancelButtonClick);
  exportFormat.addEventListener('change', onExportFormatChange);
  exportForm.addEventListener('submit', onExportFormSubmit);
  settingsCloseButton.addEventListener('click', onSettingsCloseButtonClick);
  settingsOverlay.addEventListener('change', onSettingsChange);
  settingsOverlay.addEventListener('pointerdown', onSettingsOverlayPointerDown);
  structureToolbar.addEventListener('keydown', onStructureToolbarKeyDown);
  canvasBackgroundMode.addEventListener('change', onCanvasBackgroundModeChange);
  canvasBackgroundVisibility.addEventListener('click', onCanvasBackgroundVisibilityClick);
  canvasBackgroundColorInput.addEventListener('change', onCanvasBackgroundColorChange);
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeyDown);
  addLayerButton.addEventListener('click', onAddLayerButtonClick);
  addFilterLayerButton.addEventListener('click', onAddFilterLayerButtonClick);
  addMaskButton.addEventListener('click', onAddMaskButtonClick);
  for (const toolButton of toolButtons) toolButton.addEventListener('click', onToolButtonClick);
  fitButton.addEventListener('click', onFitButtonClick);
  actualSizeButton.addEventListener('click', onActualSizeButtonClick);
  stage.addEventListener('wheel', onStageWheel, { passive: false });
  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    currentEditor()?.select([]);
    setSelectedNodeId(null);
    if (selectedImage() === null || activeTool() !== 'move') return;
    panState = {
      pointerId: event.pointerId,
      startPanX: panX(),
      startPanY: panY(),
      startX: event.clientX,
      startY: event.clientY,
    };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', event => {
    if (panState?.pointerId !== event.pointerId) return;
    setPanX(panState.startPanX + event.clientX - panState.startX);
    setPanY(panState.startPanY + event.clientY - panState.startY);
  });
  const stopPan = (event: PointerEvent): void => {
    if (panState?.pointerId !== event.pointerId) return;
    panState = null;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', stopPan);
  stage.addEventListener('pointercancel', stopPan);

  onCleanup(() => {
    input.removeEventListener('change', onInputChange);
    appShell.removeEventListener('dragenter', onDragEnter);
    appShell.removeEventListener('dragover', onDragOver);
    appShell.removeEventListener('dragleave', onDragLeave);
    appShell.removeEventListener('drop', onDrop);
    menuButton.removeEventListener('click', onMenuButtonClick);
    menuButton.removeEventListener('keydown', onMenuButtonKeyDown);
    addMenuButton.removeEventListener('click', onAddMenuButtonClick);
    addMenuButton.removeEventListener('keydown', onAddMenuButtonKeyDown);
    addMenu.removeEventListener('keydown', onAddMenuKeyDown);
    zoomMenuButton.removeEventListener('click', onZoomMenuButtonClick);
    zoomMenuButton.removeEventListener('keydown', onZoomMenuButtonKeyDown);
    zoomMenu.removeEventListener('keydown', onZoomMenuKeyDown);
    zoomInput.removeEventListener('input', onZoomInput);
    zoomInput.removeEventListener('change', onZoomInputChange);
    zoomInput.removeEventListener('keydown', onZoomInputKeyDown);
    window.removeEventListener('resize', onWindowResize);
    appMenu.removeEventListener('click', onAppMenuClick);
    appMenu.removeEventListener('keydown', onAppMenuKeyDown);
    quickActionsButton.removeEventListener('click', onQuickActionsButtonClick);
    quickActionsInput.removeEventListener('input', onQuickActionsInput);
    quickActionsInput.removeEventListener('keydown', onQuickActionsInputKeyDown);
    quickActionsOverlay.removeEventListener('pointerdown', onQuickActionsOverlayPointerDown);
    historyOverlay.removeEventListener('pointerdown', onHistoryOverlayPointerDown);
    historyCloseButton.removeEventListener('click', onHistoryCloseButtonClick);
    historyList.removeEventListener('keydown', onHistoryListKeyDown);
    exportOverlay.removeEventListener('pointerdown', onExportOverlayPointerDown);
    exportCloseButton.removeEventListener('click', onExportCloseButtonClick);
    exportCancelButton.removeEventListener('click', onExportCancelButtonClick);
    exportFormat.removeEventListener('change', onExportFormatChange);
    exportForm.removeEventListener('submit', onExportFormSubmit);
    settingsCloseButton.removeEventListener('click', onSettingsCloseButtonClick);
    settingsOverlay.removeEventListener('change', onSettingsChange);
    settingsOverlay.removeEventListener('pointerdown', onSettingsOverlayPointerDown);
    structureToolbar.removeEventListener('keydown', onStructureToolbarKeyDown);
    canvasBackgroundMode.removeEventListener('change', onCanvasBackgroundModeChange);
    canvasBackgroundVisibility.removeEventListener('click', onCanvasBackgroundVisibilityClick);
    canvasBackgroundColorInput.removeEventListener('change', onCanvasBackgroundColorChange);
    document.removeEventListener('pointerdown', onDocumentPointerDown);
    document.removeEventListener('keydown', onDocumentKeyDown);
    addLayerButton.removeEventListener('click', onAddLayerButtonClick);
    addFilterLayerButton.removeEventListener('click', onAddFilterLayerButtonClick);
    addMaskButton.removeEventListener('click', onAddMaskButtonClick);
    stage.removeEventListener('wheel', onStageWheel);
    for (const toolButton of toolButtons) {
      toolButton.removeEventListener('click', onToolButtonClick);
    }
  });
  onCleanup(() => {
    stageResizeObserver.disconnect();
    structureResizeObserver.disconnect();
    renderer?.dispose();
    manager.dispose();
  });

  createEffect(() => {
    const selectedTheme = theme();
    document.documentElement.dataset.theme = selectedTheme;
    for (const themeInput of themeInputs) themeInput.checked = themeInput.value === selectedTheme;
    savePreferences(localStorage, { theme: selectedTheme });
  });

  createEffect(() => {
    const tool = activeTool();
    stage.dataset.tool = tool;
    for (const button of toolButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
    }
  });

  createEffect(() => {
    const message = statusMessage();
    renderStatus.textContent = message;
    renderStatus.hidden = message.length === 0;
  });

  createEffect(() => {
    const selected = selectedImage();
    const url = selected?.original?.url;
    if (url !== undefined) onCleanup(() => URL.revokeObjectURL(url));
  });

  createEffect(() => {
    const selected = selectedImage();
    const projectRevision = projectGeneration();
    treeGeneration();
    const availableStructureWidth = structureWidth();
    const selectedId = selectedNodeId();
    const editor = selected?.editor ?? null;
    const canvasSelected = selectedId === null;
    canvasProperties.hidden = !canvasSelected;
    selectionProperties.hidden = canvasSelected;
    const enabled = editor !== null;
    saveProjectButton.disabled = !enabled;
    exportButton.disabled = !enabled || resolvedCurrentTarget() === null;
    addLayerButton.disabled = !enabled;
    addFilterLayerButton.disabled = !enabled;
    const selectedMaskTarget = selectedId === null ? null : maskTargetForNode(selectedId);
    addMaskButton.disabled =
      selectedMaskTarget === null ||
      editor?.project.wires.some(
        wire => wire.to.nodeId === selectedMaskTarget.id && wire.to.port === 'mask',
      ) === true;
    syncMenuActions();
    if (quickActionsOverlay.classList.contains('open')) {
      renderQuickActions(quickActionsInput.value);
    }
    if (editor === null) {
      renderEmptyCompositeStack(layerTree);
      closeStructureToolbar(false);
      return;
    }
    localStorage.setItem(
      `pixelf:recovery:${editor.project.projectId}`,
      serializeProject(editor.project),
    );
    if (selectedId !== null && editor.project.nodes[selectedId] === undefined) {
      const fallback = editor.project.targetIds[0] ?? null;
      setSelectedNodeId(fallback);
      return;
    }
    renderProjectTree(layerTree, editor.project, {
      density: densityPolicy({
        availableWidth: availableStructureWidth,
        desiredRowHeight: 40,
      }),
      expanded,
      onDelete: deleteNode,
      onLockChange: setStackItemLocked,
      onMoveLayer: moveLayerInStack,
      onOpenActions: openStructureToolbar,
      onPrimaryAction: nodeId => {
        selectNode(nodeId);
        requestAnimationFrame(focusSelectionProperties);
      },
      onSelect: selectNode,
      onReorderLayer: reorderLayerInStack,
      onToggle: toggleNode,
      onVisibilityChange: setStackItemVisibility,
      revision: `${editor.project.projectId}:${projectRevision}`,
      selectedNodeId: selectedId,
    });
    if (structureToolbarOwnerId !== null && structureToolbarOwnerId !== selectedId) {
      closeStructureToolbar(false);
    }
  });

  createEffect(() => {
    propertiesGeneration();
    const editor = currentEditor();
    const selectedId = selectedNodeId();
    if (editor === null) {
      selectionProperties.replaceChildren();
      return;
    }
    renderProperties(selectionProperties, editor.project, selectedId, {
      onParameter: (nodeId, key, value, options) => {
        const node = editor.project.nodes[nodeId];
        const definition =
          node === undefined
            ? undefined
            : nodeRegistry.require(node.type === 'filter' ? node.filterType : node.type);
        const parameterLabel =
          definition?.parameters.find(parameter => parameter.key === key)?.label ?? key;
        runCommand(
          () =>
            editor.dispatch(
              { key, nodeId, type: 'set-parameter', value },
              {
                label: `Change ${parameterLabel.toLowerCase()}`,
                mergeKey: `${nodeId}:${key}`,
              },
            ),
          options?.preserveControls !== true,
        );
      },
      onProjectName: name =>
        runCommand(() =>
          editor.dispatch(
            { name, type: 'set-project-name' },
            { label: 'Rename composite', mergeKey: 'project:name' },
          ),
        ),
      onFilterType: (nodeId, filterType) =>
        runCommand(() =>
          editor.dispatch(
            { filterType, nodeId, type: 'set-filter-type' },
            { label: `Change filter to ${nodeRegistry.require(filterType).title}` },
          ),
        ),
      onTargetContract: (nodeId, contract, options) =>
        runCommand(
          () =>
            editor.dispatch(
              { contract: normalizedContract(contract), nodeId, type: 'set-target-contract' },
              { label: 'Set composite output', mergeKey: `${nodeId}:contract` },
            ),
          options?.preserveControls !== true,
        ),
    });
  });

  createEffect(() => {
    const scale = zoom();
    const x = panX();
    const y = panY();
    const measuredStage = stageSize();
    stageContent.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    const deviceScale = measuredStage.deviceWidth / measuredStage.cssWidth;
    preview.style.imageRendering =
      Math.abs(scale - 1) < 1e-6 || hybridNearestBlend(scale * deviceScale) >= 1
        ? 'pixelated'
        : 'auto';
    const percentage = Math.round(scale * 100);
    zoomMenuLabel.textContent = `${percentage}%`;
    zoomMenuButton.setAttribute('aria-label', `Zoom options, ${percentage}%`);
    if (document.activeElement !== zoomInput) zoomInput.value = String(percentage);
    stage.classList.toggle('pixel-grid', pixelGrid());
  });

  createEffect(() => {
    projectGeneration();
    const editor = currentEditor();
    const targetId = editor?.project.targetIds[0];
    const target =
      editor === null || targetId === undefined ? undefined : editor.project.nodes[targetId];
    const enabled = target?.type === 'target';
    const background = resolvedCanvasBackground(enabled ? target.background : undefined);
    canvasBackgroundMode.disabled = !enabled;
    canvasBackgroundMode.value = background.mode;
    canvasBackgroundVisibility.disabled = !enabled;
    canvasBackgroundVisibility.dataset.off = String(!background.visible);
    canvasBackgroundVisibility.setAttribute('aria-pressed', String(background.visible));
    canvasBackgroundVisibility.setAttribute(
      'aria-label',
      background.visible ? 'Hide background' : 'Show background',
    );
    canvasBackgroundVisibility.title = background.visible ? 'Hide background' : 'Show background';
    canvasBackgroundColorRow.hidden = background.mode !== 'custom';
    canvasBackgroundColorInput.disabled = !enabled;
    canvasBackgroundColorInput.value = colorToHex(background.color ?? { a: 1, b: 1, g: 1, r: 1 });
    if (!enabled || !background.visible) stage.dataset.checker = 'true';
    else delete stage.dataset.checker;
    const polarity = enabled && background.visible ? canvasBackgroundPolarity(background) : null;
    if (polarity === null) delete stage.dataset.backdrop;
    else stage.dataset.backdrop = polarity;
    stage.style.backgroundColor =
      enabled && background.visible ? canvasBackgroundColor(background) : '';
  });

  createEffect(() => {
    const activePresentation = ++presentationGeneration;
    const selected = selectedImage();
    const mode = gpuMode();
    const original = showingOriginal();
    const scale = zoom();
    const x = panX();
    const y = panY();
    const measuredStage = stageSize();
    const activeDeviceGeneration = deviceGeneration();
    projectGeneration();
    if (selected === null) {
      stage.setAttribute('aria-label', 'Image preview');
      preview.hidden = true;
      canvas.hidden = true;
      canvasFrame.hidden = true;
      delete canvas.dataset.presentationKey;
      preview.removeAttribute('src');
      return;
    }
    const originalSource = selected.original;
    if (originalSource !== null) preview.src = originalSource.url;
    else preview.removeAttribute('src');
    preview.style.maxHeight = 'none';
    preview.style.maxWidth = 'none';
    stage.setAttribute('aria-label', original ? 'Original image preview' : 'Edited image preview');
    if (
      (original && originalSource !== null) ||
      mode !== 'ready' ||
      manager.current === null ||
      renderer === null
    ) {
      canvas.hidden = true;
      canvasFrame.hidden = true;
      preview.hidden = originalSource === null;
      return;
    }
    const targetId = selected.editor.project.targetIds[0];
    if (targetId === undefined) {
      canvas.hidden = true;
      canvasFrame.hidden = true;
      preview.hidden = false;
      return;
    }
    const authoredTarget = selected.editor.project.nodes[targetId];
    if (
      authoredTarget?.type !== 'target' ||
      resolveTargetContract(selected.editor.project, authoredTarget) === null
    ) {
      canvas.hidden = true;
      canvasFrame.hidden = true;
      preview.hidden = true;
      delete canvas.dataset.presentationKey;
      return;
    }
    try {
      const projection = projectTargetToGraph(
        selected.editor.project,
        targetId,
        selected.decodedAssets,
      );
      const target = attachCanvas(
        manager.current,
        canvas,
        measuredStage.deviceWidth,
        measuredStage.deviceHeight,
        projection.target.contract.colorSpace,
      );
      canvas.style.maxHeight = 'none';
      canvas.style.maxWidth = 'none';
      canvasFrame.style.height = `${projection.target.contract.height}px`;
      canvasFrame.style.width = `${projection.target.contract.width}px`;
      const presentationKey = `${selectionGeneration}:${activeDeviceGeneration}:${measuredStage.deviceWidth}x${measuredStage.deviceHeight}`;
      const retainPresentedFrame = canvas.dataset.presentationKey === presentationKey;
      canvas.hidden = !retainPresentedFrame;
      canvasFrame.hidden = !retainPresentedFrame;
      preview.hidden = retainPresentedFrame;
      const activeRenderer = renderer;
      void activeRenderer
        .present(
          projection.graph,
          target,
          projection.target.contract.width,
          projection.target.contract.height,
          {
            cssHeight: measuredStage.cssHeight,
            cssWidth: measuredStage.cssWidth,
            panX: x,
            panY: y,
            zoom: scale,
          },
        )
        .then(() => {
          if (activePresentation !== presentationGeneration || activeRenderer !== renderer) {
            return;
          }
          canvas.dataset.presentationKey = presentationKey;
          canvas.hidden = false;
          canvasFrame.hidden = false;
          preview.hidden = true;
          setStatusMessage('');
        })
        .catch(error => {
          if (activePresentation !== presentationGeneration) return;
          canvas.hidden = true;
          canvasFrame.hidden = true;
          preview.hidden = false;
          reportRenderingError(error);
        });
    } catch (error) {
      canvas.hidden = true;
      canvasFrame.hidden = true;
      preview.hidden = false;
      reportRenderingError(error);
    }
  });

  if (new URLSearchParams(window.location.search).has('structure-fixture')) {
    void openStructureFixture();
  }
  console.info(`[pixelf] Version: ${buildInfo.version} (${buildInfo.commit})`);
  return disposeRoot;
});

window.addEventListener('pagehide', dispose, { once: true });
