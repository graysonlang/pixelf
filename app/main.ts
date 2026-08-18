import { createEffect, createMemo, createRoot, createSignal, onCleanup } from 'solid-js';
import { buildInfo } from '../src/index.js';
import { decodeImageFile, type DecodedProjectImage } from '../src/browser/decode-image.js';
import { projectTargetToGraph } from '../src/compositor/index.js';
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
  type GpuDeviceState,
} from '../src/gpu/index.js';
import {
  createNode,
  createOpaqueId,
  duplicateSubtreeCommand,
  EditorState,
  findPrimaryParent,
  nodeRegistry,
  serializeProject,
  type LayerNode,
  type ProcessorNode,
  type ProjectCommand,
  type SourceNode,
  type TargetContract,
} from '../src/project/index.js';
import { renderProjectTree, renderProperties } from '../src/ui/editor-view.js';
import indexPath from './index.html';
import './styles.css';

export function getFilePaths(): { index: string } {
  return { index: indexPath };
}

interface SelectedImage extends DecodedProjectImage {
  editor: EditorState;
  file: File;
  url: string;
}

interface PanState {
  pointerId: number;
  startPanX: number;
  startPanY: number;
  startX: number;
  startY: number;
}

function requireElement<ElementType extends Element>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (element === null) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function deviceMessage(state: GpuDeviceState): string {
  switch (state.kind) {
    case 'idle':
      return 'WebGPU is idle';
    case 'acquiring':
      return 'Starting WebGPU...';
    case 'ready':
      return `WebGPU ready / device ${state.generation}`;
    case 'unsupported':
    case 'lost':
      return state.message;
  }
}

function normalizedContract(contract: TargetContract): TargetContract {
  if (contract.outputFormat === 'jpeg') {
    return { ...contract, alphaPolicy: 'opaque', outputBitDepth: 8 };
  }
  if (contract.outputFormat === 'webp') return { ...contract, outputBitDepth: 8 };
  return contract;
}

function download(data: BlobPart, mimeType: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.download = fileName;
  anchor.href = url;
  anchor.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
}

const dispose = createRoot(disposeRoot => {
  const input = requireElement<HTMLInputElement>('#image-input');
  const saveProjectButton = requireElement<HTMLButtonElement>('#save-project-button');
  const exportButton = requireElement<HTMLButtonElement>('#export-button');
  const metadataPolicy = requireElement<HTMLSelectElement>('#metadata-policy');
  const preview = requireElement<HTMLImageElement>('#image-preview');
  const canvas = requireElement<HTMLCanvasElement>('#gpu-preview');
  const empty = requireElement<HTMLElement>('#empty-stage');
  const sourceName = requireElement<HTMLElement>('#source-name');
  const sourceDetails = requireElement<HTMLElement>('#source-details');
  const gpuStatus = requireElement<HTMLElement>('#gpu-status');
  const layerTree = requireElement<HTMLElement>('#layer-tree');
  const propertiesPanel = requireElement<HTMLElement>('#properties-panel');
  const stage = requireElement<HTMLElement>('#stage');
  const stageContent = requireElement<HTMLElement>('#stage-content');
  const zoomOutput = requireElement<HTMLOutputElement>('#zoom-output');
  const undoButton = requireElement<HTMLButtonElement>('#undo-button');
  const redoButton = requireElement<HTMLButtonElement>('#redo-button');
  const addLayerButton = requireElement<HTMLButtonElement>('#add-layer-button');
  const operationType = requireElement<HTMLSelectElement>('#operation-type');
  const addOperationButton = requireElement<HTMLButtonElement>('#add-operation-button');
  const addMaskButton = requireElement<HTMLButtonElement>('#add-mask-button');
  const duplicateButton = requireElement<HTMLButtonElement>('#duplicate-button');
  const moveUpButton = requireElement<HTMLButtonElement>('#move-up-button');
  const moveDownButton = requireElement<HTMLButtonElement>('#move-down-button');
  const deleteButton = requireElement<HTMLButtonElement>('#delete-button');
  const fitButton = requireElement<HTMLButtonElement>('#fit-button');
  const actualSizeButton = requireElement<HTMLButtonElement>('#actual-size-button');
  const zoomOutButton = requireElement<HTMLButtonElement>('#zoom-out-button');
  const zoomInButton = requireElement<HTMLButtonElement>('#zoom-in-button');
  const panLeftButton = requireElement<HTMLButtonElement>('#pan-left-button');
  const panRightButton = requireElement<HTMLButtonElement>('#pan-right-button');
  const panUpButton = requireElement<HTMLButtonElement>('#pan-up-button');
  const panDownButton = requireElement<HTMLButtonElement>('#pan-down-button');
  const pixelGridButton = requireElement<HTMLButtonElement>('#pixel-grid-button');
  const transparencyButton = requireElement<HTMLButtonElement>('#transparency-button');
  const compareButton = requireElement<HTMLButtonElement>('#compare-button');

  const [selectedImage, setSelectedImage] = createSignal<SelectedImage | null>(null);
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [projectGeneration, setProjectGeneration] = createSignal(0);
  const [treeGeneration, setTreeGeneration] = createSignal(0);
  const [gpuMode, setGpuMode] = createSignal<'checking' | 'fallback' | 'ready'>('checking');
  const [gpuMessage, setGpuMessage] = createSignal('Checking WebGPU...');
  const [deviceGeneration, setDeviceGeneration] = createSignal(0);
  const [zoom, setZoom] = createSignal(1);
  const [panX, setPanX] = createSignal(0);
  const [panY, setPanY] = createSignal(0);
  const [pixelGrid, setPixelGrid] = createSignal(false);
  const [transparency, setTransparency] = createSignal(true);
  const [comparing, setComparing] = createSignal(false);
  const expanded = new Set<string>();
  let renderer: GpuImageRenderer | null = null;
  let selectionGeneration = 0;
  let panState: PanState | null = null;

  for (const definition of nodeRegistry.all().filter(candidate => candidate.kind === 'processor')) {
    const option = document.createElement('option');
    option.value = definition.type;
    option.textContent = definition.title;
    operationType.append(option);
  }

  const manager = new GpuDeviceManager({
    onContext: (context, generation) => {
      renderer?.dispose();
      renderer = new GpuImageRenderer(context);
      setGpuMode('ready');
      setDeviceGeneration(generation);
    },
    onState: state => {
      setGpuMessage(deviceMessage(state));
      if (state.kind === 'unsupported' || state.kind === 'lost') setGpuMode('fallback');
    },
  });
  void manager.initialize();

  const details = createMemo(() => {
    const selected = selectedImage();
    if (selected === null) return 'No source selected';
    const size = new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 1,
      style: 'unit',
      unit: 'megabyte',
      unitDisplay: 'short',
    }).format(selected.file.size / 1_000_000);
    return `${size} / ${selected.asset.width} x ${selected.asset.height}`;
  });

  const currentEditor = (): EditorState | null => selectedImage()?.editor ?? null;
  const refreshProject = (): void => {
    setProjectGeneration(generation => generation + 1);
  };
  const refreshTree = (): void => {
    setTreeGeneration(generation => generation + 1);
  };
  const reportError = (error: unknown): void => {
    setGpuMessage(error instanceof Error ? error.message : String(error));
  };
  const runCommand = (action: () => void): void => {
    try {
      action();
      refreshProject();
    } catch (error) {
      reportError(error);
    }
  };
  const selectNode = (nodeId: string): void => {
    currentEditor()?.select([nodeId]);
    setSelectedNodeId(nodeId);
  };
  const toggleNode = (nodeId: string): void => {
    if (expanded.has(nodeId)) expanded.delete(nodeId);
    else expanded.add(nodeId);
    refreshTree();
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

  const deleteNode = (nodeId: string): void => {
    const editor = currentEditor();
    if (editor === null || editor.project.nodes[nodeId] === undefined) return;
    const parent = findPrimaryParent(editor.project, nodeId);
    runCommand(() => editor.dispatch({ nodeId, type: 'remove-node' }, { label: 'Delete item' }));
    const nextSelection = parent?.node.id ?? editor.project.targetIds[0] ?? null;
    setSelectedNodeId(nextSelection);
    if (nextSelection !== null) editor.select([nextSelection]);
  };

  const addLayer = (): void => {
    const selected = selectedImage();
    if (selected === null) return;
    const editor = selected.editor;
    const targetId =
      (selectedNodeId() === null ? null : targetForNode(selectedNodeId() ?? '')) ??
      editor.project.targetIds[0];
    if (targetId === undefined || targetId === null) return;
    const source = createNode(
      'source/imported',
      createOpaqueId('node'),
      selected.file.name,
    ) as SourceNode;
    source.assetId = selected.asset.id;
    const layer = createNode(
      'layer',
      createOpaqueId('node'),
      `Layer ${Date.now().toString(36)}`,
    ) as LayerNode;
    layer.childId = source.id;
    runCommand(() =>
      editor.dispatch(
        {
          commands: [
            { node: source, parentId: null, type: 'insert-node' },
            { node: layer, parentId: targetId, type: 'insert-node' },
          ],
          type: 'batch',
        },
        { label: 'Add layer' },
      ),
    );
    expanded.add(targetId);
    expanded.add(layer.id);
    selectNode(layer.id);
  };

  const addOperation = (): void => {
    const editor = currentEditor();
    const selectedId = selectedNodeId();
    if (editor === null || selectedId === null) return;
    const selected = editor.project.nodes[selectedId];
    if (selected === undefined || selected.type === 'target') return;
    const wrappedId = selected.type === 'layer' ? selected.childId : selected.id;
    const parentId =
      selected.type === 'layer'
        ? selected.id
        : findPrimaryParent(editor.project, selected.id)?.node.id;
    if (wrappedId === null || parentId === undefined) return;
    const definition = nodeRegistry.require(operationType.value);
    if (definition.kind !== 'processor') return;
    const operation = createNode(definition.type, createOpaqueId('node')) as ProcessorNode;
    const commands: ProjectCommand[] = [{ node: operation, parentId: null, type: 'insert-node' }];
    if (operation.type === 'process/composite') {
      const image = selectedImage();
      if (image === null) return;
      const secondary = createNode(
        'source/imported',
        createOpaqueId('node'),
        `${image.file.name} secondary`,
      ) as SourceNode;
      secondary.assetId = image.asset.id;
      commands.push(
        { node: secondary, parentId: null, type: 'insert-node' },
        {
          type: 'connect',
          wire: {
            from: { nodeId: secondary.id, port: 'image' },
            id: createOpaqueId('wire'),
            to: { nodeId: operation.id, port: 'secondary' },
          },
        },
      );
    }
    commands.push(
      { index: 0, nodeId: wrappedId, parentId: operation.id, type: 'move-node' },
      { index: 0, nodeId: operation.id, parentId, type: 'move-node' },
    );
    runCommand(() =>
      editor.dispatch(
        {
          commands,
          type: 'batch',
        },
        { label: `Add ${definition.title}` },
      ),
    );
    expanded.add(parentId);
    expanded.add(operation.id);
    selectNode(operation.id);
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
    const layer = layerForNode(selectedId);
    if (
      layer === null ||
      editor.project.wires.some(wire => wire.to.nodeId === layer.id && wire.to.port === 'mask')
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
                to: { nodeId: layer.id, port: 'mask' },
              },
            },
          ],
          type: 'batch',
        },
        { label: 'Add mask' },
      ),
    );
    expanded.add(layer.id);
    selectNode(mask.id);
  };

  const moveLayer = (direction: -1 | 1): void => {
    const editor = currentEditor();
    const selectedId = selectedNodeId();
    const selected = selectedId === null ? undefined : editor?.project.nodes[selectedId];
    if (editor === null || selected?.type !== 'layer') return;
    const parent = findPrimaryParent(editor.project, selected.id);
    if (parent?.node.type !== 'target') return;
    const index = Math.max(0, Math.min(parent.node.childIds.length - 1, parent.index + direction));
    if (index === parent.index) return;
    runCommand(() =>
      editor.dispatch(
        { index, nodeId: selected.id, parentId: parent.node.id, type: 'move-node' },
        { label: 'Reorder layer' },
      ),
    );
  };

  const fitStage = (): void => {
    const selected = selectedImage();
    if (selected === null) return;
    const availableWidth = Math.max(1, stage.clientWidth - 48);
    const availableHeight = Math.max(1, stage.clientHeight - 48);
    setZoom(
      Math.max(
        0.01,
        Math.min(
          16,
          availableWidth / selected.asset.width,
          availableHeight / selected.asset.height,
        ),
      ),
    );
    setPanX(0);
    setPanY(0);
  };

  const selectImage = async (): Promise<void> => {
    const file = input.files?.[0];
    if (file === undefined) return;
    const generation = ++selectionGeneration;
    setGpuMessage(`Decoding ${file.name}...`);
    try {
      const decoded = await decodeImageFile(file);
      if (generation !== selectionGeneration) return;
      const editor = new EditorState(decoded.project);
      const targetId = decoded.project.targetIds[0] ?? null;
      expanded.clear();
      for (const nodeId of Object.keys(decoded.project.nodes)) expanded.add(nodeId);
      setSelectedImage({ ...decoded, editor, file, url: URL.createObjectURL(file) });
      setSelectedNodeId(targetId);
      if (targetId !== null) editor.select([targetId]);
      setProjectGeneration(current => current + 1);
      setTreeGeneration(current => current + 1);
      requestAnimationFrame(fitStage);
      setGpuMessage(manager.current === null ? 'Source ready / browser preview' : 'Source ready');
    } catch (error) {
      if (generation === selectionGeneration) reportError(error);
    }
  };

  const saveProject = (): void => {
    const editor = currentEditor();
    if (editor === null) return;
    const source = serializeProject(editor.project);
    download(source, 'application/json', `${editor.project.name || 'untitled'}.pixelf`);
    localStorage.removeItem(`pixelf:recovery:${editor.project.projectId}`);
    editor.markSaved();
    refreshProject();
  };

  const exportTarget = async (): Promise<void> => {
    const selected = selectedImage();
    const targetId = selected?.editor.project.targetIds[0];
    if (selected === null || selected === undefined || targetId === undefined) return;
    try {
      const projection = projectTargetToGraph(
        selected.editor.project,
        targetId,
        new Map([[selected.asset.id, selected.decoded]]),
      );
      const policy = metadataPolicy.value as MetadataPolicy;
      const contract = projection.target.contract;
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
      const baseName = selected.file.name.replace(/\.[^.]+$/, '') || 'pixelf-export';
      download(
        artifactBytes(artifact) as BlobPart,
        artifact.mimeType,
        `${baseName}.${artifact.extension}`,
      );
    } catch (error) {
      reportError(error);
    }
  };

  const onInputChange = (): void => {
    void selectImage();
  };
  input.addEventListener('change', onInputChange);
  saveProjectButton.addEventListener('click', saveProject);
  exportButton.addEventListener('click', () => void exportTarget());
  undoButton.addEventListener('click', () => {
    currentEditor()?.undo();
    refreshProject();
  });
  redoButton.addEventListener('click', () => {
    currentEditor()?.redo();
    refreshProject();
  });
  addLayerButton.addEventListener('click', addLayer);
  addOperationButton.addEventListener('click', addOperation);
  addMaskButton.addEventListener('click', addMask);
  duplicateButton.addEventListener('click', duplicateNode);
  moveUpButton.addEventListener('click', () => moveLayer(-1));
  moveDownButton.addEventListener('click', () => moveLayer(1));
  deleteButton.addEventListener('click', () => {
    const nodeId = selectedNodeId();
    if (nodeId !== null) deleteNode(nodeId);
  });
  fitButton.addEventListener('click', fitStage);
  actualSizeButton.addEventListener('click', () => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  });
  zoomOutButton.addEventListener('click', () => setZoom(value => Math.max(0.01, value / 1.25)));
  zoomInButton.addEventListener('click', () => setZoom(value => Math.min(16, value * 1.25)));
  panLeftButton.addEventListener('click', () => setPanX(value => value - 20));
  panRightButton.addEventListener('click', () => setPanX(value => value + 20));
  panUpButton.addEventListener('click', () => setPanY(value => value - 20));
  panDownButton.addEventListener('click', () => setPanY(value => value + 20));
  pixelGridButton.addEventListener('click', () => setPixelGrid(value => !value));
  transparencyButton.addEventListener('click', () => setTransparency(value => !value));
  const setCompare = (active: boolean): void => {
    setComparing(active);
  };
  compareButton.addEventListener('pointerdown', () => setCompare(true));
  compareButton.addEventListener('pointerup', () => setCompare(false));
  compareButton.addEventListener('pointercancel', () => setCompare(false));
  compareButton.addEventListener('keydown', event => {
    if (event.key === ' ' || event.key === 'Enter') setCompare(true);
  });
  compareButton.addEventListener('keyup', event => {
    if (event.key === ' ' || event.key === 'Enter') setCompare(false);
  });
  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0 || selectedImage() === null) return;
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

  onCleanup(() => input.removeEventListener('change', onInputChange));
  onCleanup(() => {
    renderer?.dispose();
    manager.dispose();
  });

  createEffect(() => {
    gpuStatus.textContent = gpuMessage();
  });

  createEffect(() => {
    const selected = selectedImage();
    if (selected !== null) onCleanup(() => URL.revokeObjectURL(selected.url));
  });

  createEffect(() => {
    const selected = selectedImage();
    projectGeneration();
    treeGeneration();
    const selectedId = selectedNodeId();
    const editor = selected?.editor ?? null;
    sourceName.textContent = selected?.file.name ?? 'Untitled image';
    sourceDetails.textContent = details();
    const enabled = editor !== null;
    saveProjectButton.disabled = !enabled;
    exportButton.disabled = !enabled;
    metadataPolicy.disabled = !enabled;
    addLayerButton.disabled = !enabled;
    undoButton.disabled = !editor?.canUndo;
    redoButton.disabled = !editor?.canRedo;
    deleteButton.disabled = selectedId === null;
    const selectedNode = selectedId === null ? undefined : editor?.project.nodes[selectedId];
    addOperationButton.disabled =
      selectedNode === undefined ||
      selectedNode.type === 'target' ||
      selectedNode.type === 'source/mask';
    operationType.disabled = addOperationButton.disabled;
    duplicateButton.disabled =
      editor === null ||
      selectedNode === undefined ||
      selectedNode.type === 'target' ||
      findPrimaryParent(editor.project, selectedNode.id) === null;
    const selectedLayer = selectedId === null ? null : layerForNode(selectedId);
    addMaskButton.disabled =
      selectedLayer === null ||
      editor?.project.wires.some(
        wire => wire.to.nodeId === selectedLayer.id && wire.to.port === 'mask',
      ) === true;
    moveUpButton.disabled = selectedNode?.type !== 'layer';
    moveDownButton.disabled = selectedNode?.type !== 'layer';
    if (editor === null) {
      layerTree.replaceChildren();
      renderProperties(
        propertiesPanel,
        {
          assets: {},
          name: '',
          nodes: {},
          projectId: 'project-empty',
          schema: 'pixelf.project',
          targetIds: [],
          version: 1,
          wires: [],
        },
        null,
        {
          onParameter: () => {},
          onTargetContract: () => {},
        },
      );
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
      expanded,
      onDelete: deleteNode,
      onSelect: selectNode,
      onToggle: toggleNode,
      selectedNodeId: selectedId,
    });
    renderProperties(propertiesPanel, editor.project, selectedId, {
      onParameter: (nodeId, key, value) =>
        runCommand(() =>
          editor.dispatch(
            { key, nodeId, type: 'set-parameter', value },
            { label: `Set ${key}`, mergeKey: `${nodeId}:${key}` },
          ),
        ),
      onTargetContract: (nodeId, contract) =>
        runCommand(() =>
          editor.dispatch(
            { contract: normalizedContract(contract), nodeId, type: 'set-target-contract' },
            { label: 'Set target output', mergeKey: `${nodeId}:contract` },
          ),
        ),
    });
  });

  createEffect(() => {
    const scale = zoom();
    const x = panX();
    const y = panY();
    stageContent.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    zoomOutput.value = `${Math.round(scale * 100)}%`;
    stage.classList.toggle('pixel-grid', pixelGrid());
    pixelGridButton.setAttribute('aria-pressed', String(pixelGrid()));
    stage.classList.toggle('solid-background', !transparency());
    transparencyButton.setAttribute('aria-pressed', String(transparency()));
  });

  createEffect(() => {
    const selected = selectedImage();
    const mode = gpuMode();
    const compare = comparing();
    projectGeneration();
    deviceGeneration();
    empty.hidden = selected !== null;
    if (selected === null) {
      preview.hidden = true;
      canvas.hidden = true;
      preview.removeAttribute('src');
      return;
    }
    preview.src = selected.url;
    preview.style.maxHeight = 'none';
    preview.style.maxWidth = 'none';
    if (compare || mode !== 'ready' || manager.current === null || renderer === null) {
      canvas.hidden = true;
      preview.hidden = false;
      return;
    }
    const targetId = selected.editor.project.targetIds[0];
    if (targetId === undefined) {
      canvas.hidden = true;
      preview.hidden = false;
      return;
    }
    try {
      const projection = projectTargetToGraph(
        selected.editor.project,
        targetId,
        new Map([[selected.asset.id, selected.decoded]]),
      );
      const target = attachCanvas(
        manager.current,
        canvas,
        projection.target.contract.width,
        projection.target.contract.height,
        projection.target.contract.colorSpace,
      );
      canvas.style.maxHeight = 'none';
      canvas.style.maxWidth = 'none';
      canvas.hidden = false;
      preview.hidden = true;
      const activeRenderer = renderer;
      void activeRenderer
        .present(
          projection.graph,
          target,
          projection.target.contract.width,
          projection.target.contract.height,
        )
        .then(() => setGpuMessage(`WebGPU preview / device ${deviceGeneration()}`))
        .catch(error => {
          canvas.hidden = true;
          preview.hidden = false;
          reportError(error);
        });
    } catch (error) {
      canvas.hidden = true;
      preview.hidden = false;
      reportError(error);
    }
  });

  console.info(`[pixelf] Version: ${buildInfo.version} (${buildInfo.commit})`);
  return disposeRoot;
});

window.addEventListener('pagehide', dispose, { once: true });
