import { isActionEnabled, isActionVisible, type UiAction } from '../actions.js';

export interface ActionPartition<Context, Command, EditorEffect> {
  overflow: readonly UiAction<Context, Command, EditorEffect>[];
  rail: readonly UiAction<Context, Command, EditorEffect>[];
}

function ordered<Context, Command, EditorEffect>(
  actions: readonly UiAction<Context, Command, EditorEffect>[],
): readonly UiAction<Context, Command, EditorEffect>[] {
  return actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => right.action.priority - left.action.priority || left.index - right.index)
    .map(entry => entry.action);
}

export function partitionStructureActions<Context, Command, EditorEffect>(
  actions: readonly UiAction<Context, Command, EditorEffect>[],
  context: Context,
  railCapacity: number,
): ActionPartition<Context, Command, EditorEffect> {
  const visible = ordered(actions).filter(action => isActionVisible(action, context));
  const railCandidates = visible.filter(action => action.surfaces.includes('rail'));
  const rail = railCandidates.slice(0, Math.max(0, railCapacity));
  const railIds = new Set(rail.map(action => action.id));
  const overflow = visible.filter(
    action =>
      !railIds.has(action.id) &&
      (action.surfaces.includes('rail') || action.surfaces.includes('overflow')),
  );
  return { overflow, rail };
}

export function firstEnabledAction<Context, Command, EditorEffect>(
  actions: readonly UiAction<Context, Command, EditorEffect>[],
  context: Context,
): UiAction<Context, Command, EditorEffect> | undefined {
  return actions.find(action => isActionEnabled(action, context));
}
