import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadPreferences,
  parsePreferences,
  PREFERENCES_KEY,
  savePreferences,
} from '../../src/ui/preferences.js';
import { primaryShortcutLabel } from '../../src/ui/platform.js';

test('preferences default invalid or unreadable themes to system appearance', () => {
  assert.deepEqual(parsePreferences(null), { theme: 'auto' });
  assert.deepEqual(parsePreferences({ theme: 'sepia' }), { theme: 'auto' });
  assert.deepEqual(parsePreferences({ theme: 'light' }), { theme: 'light' });
  assert.deepEqual(
    loadPreferences({
      getItem: () => '{bad json',
    }),
    { theme: 'auto' },
  );
});

test('preferences persist as a device-local JSON record', () => {
  let savedKey = '';
  let savedValue = '';
  savePreferences(
    {
      setItem: (key, value) => {
        savedKey = key;
        savedValue = value;
      },
    },
    { theme: 'dark' },
  );
  assert.equal(savedKey, PREFERENCES_KEY);
  assert.equal(savedValue, '{"theme":"dark"}');
});

test('shortcut labels use the primary modifier for the current platform', () => {
  assert.equal(primaryShortcutLabel('MacIntel', '/'), 'Command+/');
  assert.equal(primaryShortcutLabel('Win32', '/'), 'Ctrl+/');
});
