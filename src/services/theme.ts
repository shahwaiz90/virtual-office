export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'vo-theme';

export function getTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function setTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch (e) {
    // Storage can be unavailable (private mode); the theme still applies for this visit
  }
}
