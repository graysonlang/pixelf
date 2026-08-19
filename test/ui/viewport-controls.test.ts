import assert from 'node:assert/strict';
import test from 'node:test';
import {
  anchoredZoom,
  clampZoom,
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

test('zoom shortcuts map both fit keys, reset, plus, and minus', () => {
  assert.equal(zoomShortcut(key({ code: 'Digit1', shiftKey: true })), 'fit');
  assert.equal(zoomShortcut(key({ code: 'Digit9', shiftKey: true })), 'fit');
  assert.equal(zoomShortcut(key({ code: 'Digit0', shiftKey: true })), 'reset');
  assert.equal(zoomShortcut(key({ key: '+' })), 'in');
  assert.equal(zoomShortcut(key({ key: '-' })), 'out');
  assert.equal(zoomShortcut(key({ key: '+', metaKey: true })), null);
});

test('anchoredZoom preserves the stage point under the gesture anchor', () => {
  assert.deepEqual(anchoredZoom(1, 2, 10, -5, 100, 40), {
    panX: -80,
    panY: -50,
    zoom: 2,
  });
});

test('clampZoom bounds direct and gesture zoom', () => {
  assert.equal(clampZoom(0), 0.01);
  assert.equal(clampZoom(32), 16);
});
