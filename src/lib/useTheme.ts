import { useState, useEffect, useCallback } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'ehi-theme';

function applyTheme(theme: Theme) {
  const root = document.documentElement;

  const updateDOM = () => {
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
    }
  };

  if (typeof document !== 'undefined' && 'startViewTransition' in document && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    (document as any).startViewTransition(updateDOM);
  } else {
    updateDOM();
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    // Read saved preference; this app's default theme is dark (matches the
    // pre-paint boot script in index.html).
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
