import { useState, useEffect, useCallback } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'ehi-theme';

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.add('theme-transition');
  if (theme === 'light') {
    root.classList.add('light');
    root.classList.remove('dark');
  } else {
    root.classList.remove('light');
    root.classList.add('dark');
  }
  setTimeout(() => {
    root.classList.remove('theme-transition');
  }, 400);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    // Read saved preference, default to light
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    return saved ?? 'dark';
  });

  // Apply on mount and on change
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme(prev => prev === 'dark' ? 'light' : 'dark'), []);

  return { theme, toggle, isDark: theme === 'dark' };
}
