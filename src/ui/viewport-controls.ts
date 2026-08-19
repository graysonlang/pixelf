export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 16;

export type ZoomShortcut = 'fit' | 'in' | 'out' | 'reset';

export interface ZoomKey {
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface AnchoredZoom {
  panX: number;
  panY: number;
  zoom: number;
}

export function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

export function anchoredZoom(
  previousZoom: number,
  nextZoom: number,
  panX: number,
  panY: number,
  anchorX: number,
  anchorY: number,
): AnchoredZoom {
  const zoom = clampZoom(nextZoom);
  const ratio = zoom / previousZoom;
  return {
    panX: anchorX - (anchorX - panX) * ratio,
    panY: anchorY - (anchorY - panY) * ratio,
    zoom,
  };
}

export function zoomShortcut(key: ZoomKey): ZoomShortcut | null {
  if (key.altKey || key.ctrlKey || key.metaKey) return null;
  if (key.shiftKey && (key.code === 'Digit1' || key.code === 'Digit9')) return 'fit';
  if (key.shiftKey && key.code === 'Digit0') return 'reset';
  if (key.key === '+' || key.code === 'NumpadAdd') return 'in';
  if (key.key === '-' || key.code === 'NumpadSubtract') return 'out';
  return null;
}
