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

export interface ViewportPan {
  panX: number;
  panY: number;
}

export function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

export function fitZoom(
  contentWidth: number,
  contentHeight: number,
  availableWidth: number,
  availableHeight: number,
  allowUpscale = true,
): number {
  if (contentWidth <= 0 || contentHeight <= 0) return 1;
  const fitted = Math.min(availableWidth / contentWidth, availableHeight / contentHeight);
  return clampZoom(allowUpscale ? fitted : Math.min(1, fitted));
}

export function initialImageZoom(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  fitInset = 48,
): number {
  if (contentWidth <= viewportWidth && contentHeight <= viewportHeight) return 1;
  return fitZoom(
    contentWidth,
    contentHeight,
    Math.max(1, viewportWidth - fitInset),
    Math.max(1, viewportHeight - fitInset),
    false,
  );
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

export function panByWheel(
  panX: number,
  panY: number,
  deltaX: number,
  deltaY: number,
): ViewportPan {
  return {
    panX: panX - deltaX,
    panY: panY - deltaY,
  };
}

export function pixelGridShortcut(key: ZoomKey): boolean {
  return (key.metaKey || key.ctrlKey) && !key.altKey && !key.shiftKey && key.code === 'Quote';
}

export function originalPreviewShortcut(key: ZoomKey): boolean {
  return !key.altKey && !key.ctrlKey && !key.metaKey && !key.shiftKey && key.code === 'Backslash';
}

export function zoomShortcut(key: ZoomKey): ZoomShortcut | null {
  if (key.altKey || key.ctrlKey || key.metaKey) return null;
  if (key.shiftKey && (key.code === 'Digit1' || key.code === 'Digit9')) return 'fit';
  if (key.shiftKey && key.code === 'Digit0') return 'reset';
  if (key.key === '+' || key.code === 'NumpadAdd') return 'in';
  if (key.key === '-' || key.code === 'NumpadSubtract') return 'out';
  return null;
}
