import type { CanvasBackground, CanvasBackgroundColor } from '../project/types.js';

export const DEFAULT_CANVAS_BACKGROUND: Readonly<CanvasBackground> = Object.freeze({
  mode: 'theme',
  visible: true,
});

export function resolvedCanvasBackground(
  background: CanvasBackground | undefined,
): CanvasBackground {
  return background === undefined ? { ...DEFAULT_CANVAS_BACKGROUND } : structuredClone(background);
}

export function colorToHex(color: CanvasBackgroundColor): string {
  const channel = (value: number): string =>
    Math.round(Math.max(0, Math.min(1, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

export function colorFromHex(value: string): CanvasBackgroundColor {
  const normalized = /^#[\da-f]{6}$/i.test(value) ? value.slice(1) : 'ffffff';
  return {
    a: 1,
    b: Number.parseInt(normalized.slice(4, 6), 16) / 255,
    g: Number.parseInt(normalized.slice(2, 4), 16) / 255,
    r: Number.parseInt(normalized.slice(0, 2), 16) / 255,
  };
}

export function canvasBackgroundColor(background: CanvasBackground): string {
  if (background.mode === 'light') return '#f5f5f5';
  if (background.mode === 'dark') return '#161616';
  if (background.mode === 'custom' && background.color !== undefined) {
    return colorToHex(background.color);
  }
  return '';
}

export function canvasBackgroundPolarity(background: CanvasBackground): 'dark' | 'light' | null {
  if (background.mode === 'light') return 'light';
  if (background.mode === 'dark') return 'dark';
  if (background.mode !== 'custom' || background.color === undefined) return null;
  const luminance =
    0.2126 * background.color.r + 0.7152 * background.color.g + 0.0722 * background.color.b;
  return luminance > 0.5 ? 'light' : 'dark';
}
