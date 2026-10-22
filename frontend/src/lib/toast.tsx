import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import Icon, { type IconName } from './icons';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface Toast { id: number; kind: ToastKind; title: string; body?: string }

const Ctx = createContext<{ notify: (kind: ToastKind, title: string, body?: string) => void }>({
  notify: () => undefined,
});

const ICON: Record<ToastKind, IconName> = { success: 'check', error: 'alert', info: 'info', warning: 'clock' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(1);

  const notify = useCallback((kind: ToastKind, title: string, body?: string) => {
    const id = seq.current++;
    setItems((l) => [...l.slice(-3), { id, kind, title, body }]);
    window.setTimeout(() => {
      const el = document.getElementById(`toast-${id}`);
      el?.classList.add('out');
      window.setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 180);
    }, 4200);
  }, []);

  return (
    <Ctx.Provider value={{ notify }}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} id={`toast-${t.id}`} className={`toast toast-${t.kind}`} role="status">
            <Icon name={ICON[t.kind]} size={20} />
            <div>
              <strong>{t.title}</strong>
              {t.body && <small>{t.body}</small>}
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
