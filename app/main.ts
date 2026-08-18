import { createEffect, createMemo, createRoot, createSignal, onCleanup } from 'solid-js';
import { buildInfo } from '../src/index.js';
import { decodeImageFile, type DecodedProjectImage } from '../src/browser/decode-image.js';
import { projectTargetToGraph } from '../src/compositor/index.js';
import {
  attachCanvas,
  GpuDeviceManager,
  GpuImageRenderer,
  type GpuDeviceState,
} from '../src/gpu/index.js';
import indexPath from './index.html';
import './styles.css';

export function getFilePaths(): { index: string } {
  return { index: indexPath };
}

interface SelectedImage extends DecodedProjectImage {
  file: File;
  url: string;
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

const dispose = createRoot(disposeRoot => {
  const input = requireElement<HTMLInputElement>('#image-input');
  const preview = requireElement<HTMLImageElement>('#image-preview');
  const canvas = requireElement<HTMLCanvasElement>('#gpu-preview');
  const empty = requireElement<HTMLElement>('#empty-stage');
  const sourceName = requireElement<HTMLElement>('#source-name');
  const sourceDetails = requireElement<HTMLElement>('#source-details');
  const gpuStatus = requireElement<HTMLElement>('#gpu-status');
  const [selectedImage, setSelectedImage] = createSignal<SelectedImage | null>(null);
  const [gpuMode, setGpuMode] = createSignal<'checking' | 'fallback' | 'ready'>('checking');
  const [gpuMessage, setGpuMessage] = createSignal('Checking WebGPU...');
  const [deviceGeneration, setDeviceGeneration] = createSignal(0);
  let renderer: GpuImageRenderer | null = null;
  let selectionGeneration = 0;

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
    return `${selected.file.type || 'Unknown image type'} / ${size} / ${selected.asset.width} x ${selected.asset.height}`;
  });

  const selectImage = async (): Promise<void> => {
    const file = input.files?.[0];
    if (file === undefined) return;
    const generation = ++selectionGeneration;
    setGpuMessage(`Decoding ${file.name}...`);
    try {
      const decoded = await decodeImageFile(file);
      if (generation !== selectionGeneration) return;
      setSelectedImage({ ...decoded, file, url: URL.createObjectURL(file) });
      setGpuMessage(manager.current === null ? 'Source ready / browser preview' : 'Source ready');
    } catch (error) {
      if (generation !== selectionGeneration) return;
      setGpuMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const onInputChange = (): void => {
    void selectImage();
  };
  input.addEventListener('change', onInputChange);
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
    const mode = gpuMode();
    deviceGeneration();
    empty.hidden = selected !== null;
    sourceName.textContent = selected?.file.name ?? 'Untitled image';
    sourceDetails.textContent = details();
    if (selected === null) {
      preview.hidden = true;
      canvas.hidden = true;
      preview.removeAttribute('src');
      return;
    }
    preview.src = selected.url;
    onCleanup(() => URL.revokeObjectURL(selected.url));
    if (mode !== 'ready' || manager.current === null || renderer === null) {
      canvas.hidden = true;
      preview.hidden = false;
      return;
    }
    const targetId = selected.project.targetIds[0];
    if (targetId === undefined) throw new Error('Imported project has no target');
    const projection = projectTargetToGraph(
      selected.project,
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
      .then(() => {
        setGpuMessage(`WebGPU preview / device ${deviceGeneration()}`);
      })
      .catch(error => {
        setGpuMessage(error instanceof Error ? error.message : String(error));
        setGpuMode('fallback');
      });
  });

  console.info(`[pixelf] Version: ${buildInfo.version} (${buildInfo.commit})`);
  return disposeRoot;
});

window.addEventListener('pagehide', dispose, { once: true });
