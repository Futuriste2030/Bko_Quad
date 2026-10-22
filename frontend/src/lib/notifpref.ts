import { useEffect, useState } from 'react';

/* Interrupteur applicatif des alertes système : le navigateur ne permet pas
   de retirer l'autorisation par code — le Hub cesse simplement d'envoyer. */
const KEY = 'bko.notify.enabled';
const EVT = 'bko.notify-changed';

export function isNotifyEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== '0'; }
  catch { return true; }
}

export function setNotifyEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* stockage indisponible */ }
  window.dispatchEvent(new Event(EVT));
}

export function useNotifyEnabled(): boolean {
  const [on, setOn] = useState(() => isNotifyEnabled());
  useEffect(() => {
    const sync = () => setOn(isNotifyEnabled());
    window.addEventListener(EVT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return on;
}

export type NotifPerm = NotificationPermission | 'unsupported';

export function currentPerm(): NotifPerm {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

interface NativeBridge {
  notify: (title: string, body: string, tag: string) => void;
}

function nativeBridge(): NativeBridge | null {
  const w = window as unknown as { BkoNative?: Partial<NativeBridge> };
  if (w.BkoNative && typeof w.BkoNative.notify === 'function') {
    return { notify: (t, b, r) => w.BkoNative!.notify!(t, b, r) };
  }
  return null;
}

/* Alerte système une et une seule : pont natif APK (WebView muette, pas
   de Notification API) → service worker (PWA installée, Android Chrome)
   → Notification de la page en dernier recours. */
export async function showSystemNotification(title: string, body: string, tag = ''): Promise<void> {
  if (!isNotifyEnabled()) return;
  const native = nativeBridge();
  if (native) {
    try {
      native.notify(title, body, tag);
      return;
    } catch { /* pont indisponible : on tente les voies web */ }
  }
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, {
          body,
          tag: tag || undefined,
          icon: '/android-chrome-192x192.png',
          badge: '/favicon-32x32.png',
        });
        return;
      }
    } catch { /* SW absent : on tente la Notification de la page */ }
  }
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, tag: tag || undefined });
    }
  } catch { /* notifications indisponibles */ }
}
