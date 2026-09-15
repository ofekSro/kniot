export type ThemeMode = 'system' | 'light' | 'dark'

const KEY = 'theme'

function safeGet(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function getStoredTheme(): ThemeMode {
  const v = safeGet()
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

export function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveIsDark(mode: ThemeMode): boolean {
  return mode === 'dark' || (mode === 'system' && prefersDark())
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', resolveIsDark(mode))
}

export function setStoredTheme(mode: ThemeMode): void {
  try {
    if (mode === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, mode)
  } catch {
    // Private mode / blocked storage: the theme still applies for this session.
  }
  applyTheme(mode)
}

export const THEME_LABELS: Record<ThemeMode, string> = {
  system: 'מערכת',
  light: 'בהיר',
  dark: 'כהה',
}
