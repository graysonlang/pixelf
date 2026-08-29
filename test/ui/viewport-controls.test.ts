import assert from 'node:assert/strict';
import test from 'node:test';
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
  zoomShortcut,
  type ZoomKey,
} from '../../src/ui/viewport-controls.js';

function key(changes: Partial<ZoomKey>): ZoomKey {
  return {
    altKey: false,
    code: '',
    ctrlKey: false,
    key: '',
    metaKey: false,
    shiftKey: false,
    ...changes,
  };
}

test('zoom shortcuts map fit, actual size, and physical plus and minus keys', () => {
  assert.equal(zoomShortcut(key({ code: 'Digit1', shiftKey: true })), 'fit');
  assert.equal(zoomShortcut(key({ code: 'Digit9', shiftKey: true })), 'fit');
  assert.equal(zoomShortcut(key({ code: 'Digit0', shiftKey: true })), 'reset');
  for (const modifiers of [
    {},
    { shiftKey: true },
    { metaKey: true },
    { metaKey: true, shiftKey: true },
  ]) {
    assert.equal(zoomShortcut(key({ code: 'Equal', ...modifiers })), 'in');
    assert.equal(zoomShortcut(key({ code: 'Minus', ...modifiers })), 'out');
  }
  assert.equal(zoomShortcut(key({ code: 'Equal', ctrlKey: true })), null);
  assert.equal(zoomShortcut(key({ altKey: true, code: 'Minus' })), null);
});

test("pixel grid shortcut maps Command+' and its control-key equivalent", () => {
  assert.equal(pixelGridShortcut(key({ code: 'Quote', metaKey: true })), true);
  assert.equal(pixelGridShortcut(key({ code: 'Quote', ctrlKey: true })), true);
  assert.equal(pixelGridShortcut(key({ code: 'Quote', metaKey: true, shiftKey: true })), false);
});

test('original preview shortcut maps an unmodified backslash', () => {
  assert.equal(originalPreviewShortcut(key({ code: 'Backslash', key: '\\' })), true);
  assert.equal(originalPreviewShortcut(key({ code: 'Backslash', metaKey: true })), false);
  assert.equal(originalPreviewShortcut(key({ code: 'Backslash', shiftKey: true })), false);
});

test('anchoredZoom preserves the stage point under the gesture anchor', () => {
  assert.deepEqual(anchoredZoom(1, 2, 10, -5, 100, 40), {
    panX: -80,
    panY: -50,
    zoom: 2,
  });
});

test('actualSizeViewport changes only the scale', () => {
  assert.deepEqual(actualSizeViewport(48, -27), {
    panX: 48,
    panY: -27,
    zoom: 1,
  });
});

test('fitZoom leaves small imports at 100% unless upscaling is requested', () => {
  assert.equal(fitZoom(400, 300, 800, 600, false), 1);
  assert.equal(fitZoom(400, 300, 800, 600), 2);
  assert.equal(fitZoom(1600, 1200, 800, 600, false), 0.5);
});

test('initialImageZoom uses full stage dimensions before applying a fit inset', () => {
  assert.equal(initialImageZoom(980, 780, 1000, 800), 1);
  assert.equal(initialImageZoom(1200, 800, 1000, 800), 0.7933333333333333);
});

test('panByWheel translates opposite the trackpad scroll delta', () => {
  assert.deepEqual(panByWheel(20, -10, 6, -4), {
    panX: 14,
    panY: -6,
  });
});

test('wheel zoom accepts Control and Command modifiers', () => {
  assert.equal(wheelZoomModifier(key({ ctrlKey: true })), true);
  assert.equal(wheelZoomModifier(key({ metaKey: true })), true);
  assert.equal(wheelZoomModifier(key({})), false);
});

test('clampZoom bounds direct and gesture zoom', () => {
  assert.equal(clampZoom(0), 0.01);
  assert.equal(clampZoom(32), 16);
});
