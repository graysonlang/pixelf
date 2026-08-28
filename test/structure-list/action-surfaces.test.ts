import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UiAction } from '../../src/ui/actions.js';
import {
  firstEnabledAction,
  partitionStructureActions,
} from '../../src/ui/structure-list/index.js';

type Action = UiAction<{ allowed: boolean }, never, string>;

function action(
  id: string,
  priority: number,
  surfaces: Action['surfaces'] = ['rail', 'overflow'],
): Action {
  return {
    enabled: context => context.allowed || id !== 'delete',
    group: 'fixture',
    id,
    invoke: () => ({ effect: id, kind: 'editor' }),
    label: id,
    priority,
    surfaces,
  };
}

describe('structure list action surfaces', () => {
  it('partitions rail and overflow without duplicates in priority order', () => {
    const actions = [action('delete', 10), action('properties', 100), action('duplicate', 50)];
    const result = partitionStructureActions(actions, { allowed: true }, 2);
    assert.deepEqual(
      result.rail.map(item => item.id),
      ['properties', 'duplicate'],
    );
    assert.deepEqual(
      result.overflow.map(item => item.id),
      ['delete'],
    );
  });

  it('keeps overflow-only actions and finds the first enabled action', () => {
    const actions = [
      action('delete', 10),
      action('rename', 5, ['overflow']),
      action('properties', 100),
    ];
    const result = partitionStructureActions(actions, { allowed: false }, 0);
    assert.deepEqual(result.rail, []);
    assert.deepEqual(
      result.overflow.map(item => item.id),
      ['properties', 'delete', 'rename'],
    );
    assert.equal(firstEnabledAction(result.overflow, { allowed: false })?.id, 'properties');
  });
});
