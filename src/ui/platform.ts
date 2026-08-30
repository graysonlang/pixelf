function isApplePlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export type ShortcutModifier = 'command' | 'control' | 'option' | 'shift';

const shortcutModifierSymbols: Readonly<Record<ShortcutModifier, string>> = {
  command: '\u2318',
  control: '\u2303',
  option: '\u2325',
  shift: '\u21e7',
};

export function shortcutLabel(modifiers: readonly ShortcutModifier[], key: string): string {
  return `${modifiers.map(modifier => shortcutModifierSymbols[modifier]).join('')}${key}`;
}

export function primaryShortcutLabel(platform: string, key: string): string {
  return shortcutLabel([isApplePlatform(platform) ? 'command' : 'control'], key);
}
