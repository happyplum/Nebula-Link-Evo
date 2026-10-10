export interface LayoutPreferences {
  leftWidth: number;
  rightWidth: number;
  chatCollapsed: boolean;
  browserFocused: boolean;
  browserCollapsed: boolean;
  browserZoom: number;
  theme: 'system' | 'light' | 'dark';
}

export function text(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value ? value : fallback;
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
