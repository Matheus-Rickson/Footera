import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'fmsim.theme';
const EVENT = 'fmsim:theme';

/** Tema salvo (escuro por padrão). Preferência local do aparelho, não do save. */
export function storedTheme(): Theme {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* preferência opcional */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: theme }));
}

/** Tema atual e alternância, sincronizados entre componentes. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  useEffect(() => {
    const on = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return [theme, () => applyTheme(theme === 'dark' ? 'light' : 'dark')];
}
