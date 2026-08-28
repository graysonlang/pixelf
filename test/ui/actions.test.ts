import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actionSupportsSurface,
  actionsForSurface,
  filterActions,
  isActionEnabled,
  isActionVisible,
  type ActionSurface,
  type UiAction,
} from '../../src/ui/actions.js';

interface TestContext {
  enabled: boolean;
  visible: boolean;
}

type TestAction = UiAction<TestContext, string, string>;

function action(
  id: string,
  label: string,
  keywords: readonly string[] = [],
  surfaces: readonly ActionSurface[] = ['quick-actions'],
): TestAction {
  return {
    group: 'test',
    id,
    invoke: () => ({ effect: id, kind: 'editor' }),
    keywords,
    label,
    priority: 0,
    surfaces,
  };
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
  const context = { enabled: false, visible: true };
  assert.equal(isActionEnabled(action('open', 'Open image'), context), true);
  assert.equal(
    isActionEnabled(
      { ...action('save', 'Save project'), enabled: current => current.enabled },
      context,
    ),
    false,
  );
});

test('actions derive visible surface sets without changing registry order', () => {
  const context = { enabled: true, visible: false };
  const open = action('open', 'Open image', [], ['menu', 'quick-actions']);
  const hidden = {
    ...action('hidden', 'Hidden action'),
    visible: (current: TestContext) => current.visible,
  };
  const save = action('save', 'Save project', [], ['quick-actions']);
  const actions = [open, hidden, save];

  assert.equal(actionSupportsSurface(open, 'menu'), true);
  assert.equal(isActionVisible(hidden, context), false);
  assert.deepEqual(actionsForSurface(actions, 'quick-actions', context), [open, save]);
});

test('actions return a typed command or editor effect for a consumer to execute', () => {
  const result = action('open', 'Open image').invoke({ enabled: true, visible: true });
  assert.deepEqual(result, { effect: 'open', kind: 'editor' });
});
