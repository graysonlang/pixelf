export type HistoryShortcut = 'open' | 'redo' | 'undo';

interface HistoryShortcutEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export function historyShortcut(event: HistoryShortcutEvent): HistoryShortcut | null {
  if ((!event.metaKey && !event.ctrlKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'open';
  return null;
}
