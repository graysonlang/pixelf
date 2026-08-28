export type ActionSurface =
  | 'context'
  | 'keyboard'
  | 'menu'
  | 'overflow'
  | 'properties'
  | 'quick-actions'
  | 'rail';

export type ActionResult<Command, EditorEffect> =
  | { command: Command; kind: 'command' }
  | { effect: EditorEffect; kind: 'editor' };

export interface UiAction<Context, Command, EditorEffect> {
  enabled?: (context: Context) => boolean;
  glyph?: string;
  group: string;
  id: string;
  invoke(context: Context): ActionResult<Command, EditorEffect>;
  keywords?: readonly string[];
  label: string;
  priority: number;
  shortcut?: string;
  surfaces: readonly ActionSurface[];
  visible?: (context: Context) => boolean;
}

export function isActionEnabled<Context, Command, EditorEffect>(
  action: UiAction<Context, Command, EditorEffect>,
  context: Context,
): boolean {
  return action.enabled?.(context) ?? true;
}

export function isActionVisible<Context, Command, EditorEffect>(
  action: UiAction<Context, Command, EditorEffect>,
  context: Context,
): boolean {
  return action.visible?.(context) ?? true;
}

export function actionSupportsSurface<Context, Command, EditorEffect>(
  action: UiAction<Context, Command, EditorEffect>,
  surface: ActionSurface,
): boolean {
  return action.surfaces.includes(surface);
}

export function actionsForSurface<Context, Command, EditorEffect>(
  actions: readonly UiAction<Context, Command, EditorEffect>[],
  surface: ActionSurface,
  context: Context,
): readonly UiAction<Context, Command, EditorEffect>[] {
  return actions.filter(
    action => actionSupportsSurface(action, surface) && isActionVisible(action, context),
  );
}

interface SearchableAction {
  keywords?: readonly string[];
  label: string;
}

export function filterActions<Action extends SearchableAction>(
  actions: readonly Action[],
  query: string,
): readonly Action[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return actions;
  return actions.filter(action => {
    const searchable = [action.label, ...(action.keywords ?? [])].join(' ').toLowerCase();
    return terms.every(term => searchable.includes(term));
  });
}
