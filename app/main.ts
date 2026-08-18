import { createEffect, createMemo, createRoot, createSignal, onCleanup } from 'solid-js';
import { buildInfo } from '../src/index.js';
import indexPath from './index.html';
import './styles.css';

export function getFilePaths(): { index: string } {
  return { index: indexPath };
}

interface SelectedImage {
  file: File;
  url: string;
}

function requireElement<ElementType extends Element>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (element === null) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const dispose = createRoot(disposeRoot => {
  const input = requireElement<HTMLInputElement>('#image-input');
  const preview = requireElement<HTMLImageElement>('#image-preview');
  const empty = requireElement<HTMLElement>('#empty-stage');
  const sourceName = requireElement<HTMLElement>('#source-name');
  const sourceDetails = requireElement<HTMLElement>('#source-details');
  const [selectedImage, setSelectedImage] = createSignal<SelectedImage | null>(null);

  const details = createMemo(() => {
    const selected = selectedImage();
    if (selected === null) return 'No source selected';
    const size = new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 1,
      style: 'unit',
      unit: 'megabyte',
      unitDisplay: 'short',
    }).format(selected.file.size / 1_000_000);
    return `${selected.file.type || 'Unknown image type'} / ${size}`;
  });

  const selectImage = (): void => {
    const file = input.files?.[0];
    if (file === undefined) return;
    setSelectedImage({ file, url: URL.createObjectURL(file) });
  };

  input.addEventListener('change', selectImage);
  onCleanup(() => input.removeEventListener('change', selectImage));

  createEffect(() => {
    const selected = selectedImage();
    preview.hidden = selected === null;
    empty.hidden = selected !== null;
    sourceName.textContent = selected?.file.name ?? 'Untitled image';
    sourceDetails.textContent = details();
    if (selected === null) {
      preview.removeAttribute('src');
      return;
    }
    preview.src = selected.url;
    onCleanup(() => URL.revokeObjectURL(selected.url));
  });

  console.info(`[pixelf] Version: ${buildInfo.version} (${buildInfo.commit})`);
  return disposeRoot;
});

window.addEventListener('pagehide', dispose, { once: true });
