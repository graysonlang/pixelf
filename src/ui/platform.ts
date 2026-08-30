function isApplePlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export function primaryShortcutLabel(platform: string, key: string): string {
  return `${isApplePlatform(platform) ? '\u2318' : 'Ctrl+'}${key}`;
}
