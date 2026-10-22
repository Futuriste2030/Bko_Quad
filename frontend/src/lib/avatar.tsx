import { useEffect, useState } from 'react';

/* Photo de profil locale (aperçu 96px) partagée entre le Profil et la
   barre supérieure : un événement tient les deux affichages synchronisés. */
const KEY = 'bko.avatar';
const EVT = 'bko.avatar-changed';

export function loadAvatar(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function saveAvatar(data: string): void {
  try { localStorage.setItem(KEY, data); } catch { /* stockage plein */ }
  window.dispatchEvent(new Event(EVT));
}

export function useAvatar(): string | null {
  const [avatar, setAvatar] = useState<string | null>(() => loadAvatar());
  useEffect(() => {
    const on = () => setAvatar(loadAvatar());
    window.addEventListener(EVT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(EVT, on);
      window.removeEventListener('storage', on);
    };
  }, []);
  return avatar;
}

/* Réduit un fichier image en carré 96px JPEG puis le mémorise. */
export function storeAvatarFile(file: File | undefined): Promise<boolean> {
  if (!file) return Promise.resolve(false);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(false);
    reader.onload = () => {
      try {
        const img = new Image();
        img.onerror = () => resolve(false);
        img.onload = () => {
          try {
            const c = document.createElement('canvas');
            const s = 96;
            c.width = s; c.height = s;
            const ctx = c.getContext('2d');
            if (!ctx) { resolve(false); return; }
            const side = Math.min(img.width, img.height);
            ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, s, s);
            saveAvatar(c.toDataURL('image/jpeg', 0.8));
            resolve(true);
          } catch { resolve(false); }
        };
        img.src = String(reader.result);
      } catch { resolve(false); }
    };
    reader.readAsDataURL(file);
  });
}
