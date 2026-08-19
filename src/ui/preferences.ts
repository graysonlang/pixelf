export type ThemePreference = 'auto' | 'dark' | 'light';

export interface Preferences {
  theme: ThemePreference;
}

export const PREFERENCES_KEY = 'pixelf:preferences';

const DEFAULT_PREFERENCES: Preferences = {
  theme: 'auto',
};

export function isThemePreference(value: string): value is ThemePreference {
  return value === 'auto' || value === 'dark' || value === 'light';
}

export function parsePreferences(raw: unknown): Preferences {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PREFERENCES };
  const theme = (raw as Record<string, unknown>).theme;
  return {
    theme: typeof theme === 'string' && isThemePreference(theme) ? theme : 'auto',
  };
}

export function loadPreferences(storage: Pick<Storage, 'getItem'>): Preferences {
  try {
    const stored = storage.getItem(PREFERENCES_KEY);
    return stored === null ? { ...DEFAULT_PREFERENCES } : parsePreferences(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(storage: Pick<Storage, 'setItem'>, preferences: Preferences): void {
  try {
    storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
  }
}
