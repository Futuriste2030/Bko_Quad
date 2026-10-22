import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'bko.theme';
const Ctx = createContext<{ theme: Theme; resolved: Theme; toggle: () => void; set: (t: Theme) => void }>({
  theme: 'light', resolved: 'light', toggle: () => undefined, set: () => undefined,
});

function initial(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch { return null; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Défaut = clair ; le système n'impose rien. Seul un choix enregistré (clair/sombre) est repris.
  const [theme, setTheme] = useState<Theme>(() => initial() ?? 'light');
  const [resolved, setResolved] = useState<Theme>(theme);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    setResolved(theme);
    try { localStorage.setItem(KEY, theme); } catch { /* stockage indisponible */ }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  const set = useCallback((t: Theme) => setTheme(t), []);

  return <Ctx.Provider value={{ theme, resolved, toggle, set }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
