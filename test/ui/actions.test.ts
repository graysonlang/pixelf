import assert from 'node:assert/strict';
import test from 'node:test';
import { filterActions, isActionEnabled, type QuickAction } from '../../src/ui/actions.js';

function action(id: string, label: string, keywords: readonly string[] = []): QuickAction {
  return { id, keywords, label, run: () => {} };
}

test('filterActions matches labels and keywords with every search term', () => {
  const actions = [
    action('open', 'Open image', ['import', 'file']),
    action('export', 'Export target', ['save', 'png']),
  ];

  assert.deepEqual(filterActions(actions, 'image file'), [actions[0]]);
  assert.deepEqual(filterActions(actions, 'save'), [actions[1]]);
  assert.deepEqual(filterActions(actions, 'missing'), []);
});

test('filterActions preserves registry order for an empty query', () => {
  const actions = [action('open', 'Open image'), action('save', 'Save project')];
  assert.equal(filterActions(actions, '  '), actions);
});

test('isActionEnabled defaults to true and honors an explicit predicate', () => {
  assert.equal(isActionEnabled(action('open', 'Open image')), true);
  assert.equal(isActionEnabled({ ...action('save', 'Save project'), enabled: () => false }), false);
});
