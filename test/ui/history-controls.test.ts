import assert from 'node:assert/strict';
import test from 'node:test';
import { historyShortcut } from '../../src/ui/history-controls.js';

function shortcut(
  key: string,
  options: Partial<{
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }> = {},
) {
  return historyShortcut({
    altKey: options.altKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    key,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
  });
}

test('history shortcuts map primary Z gestures and the history dialog', () => {
  assert.equal(shortcut('z', { metaKey: true }), 'undo');
  assert.equal(shortcut('Z', { ctrlKey: true, shiftKey: true }), 'redo');
  assert.equal(shortcut('y', { metaKey: true }), 'open');
  assert.equal(shortcut('y', { altKey: true, metaKey: true }), null);
  assert.equal(shortcut('z'), null);
});
