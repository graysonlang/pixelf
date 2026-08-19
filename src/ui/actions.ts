export interface QuickAction {
  enabled?: () => boolean;
  id: string;
  keywords?: readonly string[];
  label: string;
  run: () => unknown;
  shortcut?: string;
}

export function isActionEnabled(action: QuickAction): boolean {
  return action.enabled?.() ?? true;
}

export function filterActions(
  actions: readonly QuickAction[],
  query: string,
): readonly QuickAction[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return actions;
  return actions.filter(action => {
    const searchable = [action.label, ...(action.keywords ?? [])].join(' ').toLowerCase();
    return terms.every(term => searchable.includes(term));
  });
}
