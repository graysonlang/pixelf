import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canvasBackgroundColor,
  canvasBackgroundPolarity,
  colorFromHex,
  colorToHex,
  resolvedCanvasBackground,
} from '../../src/ui/canvas-background.js';

test('canvas backgrounds default to a visible theme match', () => {
  assert.deepEqual(resolvedCanvasBackground(undefined), { mode: 'theme', visible: true });
  assert.equal(canvasBackgroundColor({ mode: 'light', visible: true }), '#f5f5f5');
  assert.equal(canvasBackgroundColor({ mode: 'dark', visible: true }), '#161616');
});

test('custom canvas background colors round-trip through the native color input', () => {
  const color = colorFromHex('#804020');
  assert.deepEqual(color, { a: 1, b: 32 / 255, g: 64 / 255, r: 128 / 255 });
  assert.equal(colorToHex(color), '#804020');
  assert.equal(canvasBackgroundColor({ color, mode: 'custom', visible: true }), '#804020');
  assert.equal(canvasBackgroundPolarity({ color, mode: 'custom', visible: true }), 'dark');
  assert.equal(canvasBackgroundPolarity({ mode: 'theme', visible: true }), null);
});
