const STORAGE_KEY = 'localai-theme'

export type Theme = 'light' | 'dark'

/** index.html applies the stored theme before first paint; this reads it back. */
export function getTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Private browsing — theme just won't persist.
  }
}
