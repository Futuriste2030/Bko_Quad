import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  cachedMe, hrActivity, isLoggedIn, listAnomalies, listBookings, listCalls,
  listSpareParts, type HRActivity, type SparePart,
} from './api';
import { isNotifyEnabled, showSystemNotification } from './notifpref';

export interface Notice {
  kind: 'booking' | 'anomaly' | 'call' | 'part' | 'hr';
  title: string;
  body: string;
  at: number;
  link: string;
}

interface CtxV {
  items: Notice[];
  unread: number;
  readAll: () => void;
  pushBrowser: (n: Notice) => void;
}

const Ctx = createContext<CtxV>({ items: [], unread: 0, readAll: () => undefined, pushBrowser: () => undefined });

const SEEN = 'bko.notif.seen';

/* Notifications temps réel (sans websocket) : sondage 30 s des compteurs
   réservations / anomalies / appels / pièces + cloche + notification navigateur. */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const prev = useRef({
    bookings: 0, anomalies: 0, calls: 0, parts: 0,
    usedParts: new Set<number>(),
    hrToSign: new Set<string>(), hrSigned: new Set<string>(), init: false,
  });

  const pushBrowser = useCallback((n: Notice) => {
    try {
      if (!isNotifyEnabled()) return;
      /* Une seule voie gagnante : pont natif APK, sinon service worker
         (PWA installée), sinon Notification de la page. */
      void showSystemNotification(`BKO Quad — ${n.title}`, n.body, n.kind);
    } catch { /* notifications indisponibles */ }
  }, []);

  const readAll = useCallback(() => {
    setUnread(0);
    try { localStorage.setItem(SEEN, String(Date.now())); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let alive = true;
    async function poll() {
      if (!isLoggedIn()) return; // pas de 401 en rafale avant connexion
      try {
        /* Le stock de pièces est réservé aux rôles Flotte (guide et plus). */
        const me = cachedMe();
        const canSeeParts = !!me && ['guide', 'responsable', 'admin', 'superadmin'].includes(me.role);
        const partsPromise: Promise<SparePart[]> = canSeeParts
          ? listSpareParts().catch(() => [] as SparePart[])
          : Promise.resolve([] as SparePart[]);
        const emptyHR: HRActivity = { to_sign: [], signed: [] };
        const hrPromise: Promise<HRActivity> = me && me.role !== 'client'
          ? hrActivity().catch(() => emptyHR)
          : Promise.resolve(emptyHR);
        const [b, a, c, p, h] = await Promise.all([
          listBookings().catch(() => []),
          listAnomalies().catch(() => []),
          listCalls().catch(() => []),
          partsPromise,
          hrPromise,
        ]);
        if (!alive) return;
        const usedParts = p.filter((x) => x.status === 'used');
        const cur = {
          bookings: b.length,
          anomalies: a.filter((x) => x.status === 'open').length,
          calls: c.length,
          parts: p.filter((x) => x.status === 'available').length,
        };
        const notes: Notice[] = [];
        const at = Date.now();
        if (prev.current.init) {
          if (cur.bookings > prev.current.bookings) {
            notes.push({ kind: 'booking', title: 'Nouvelle réservation', body: `${cur.bookings - prev.current.bookings} réservation(s) enregistrée(s).`, at, link: '/reservations' });
          }
          if (cur.anomalies > prev.current.anomalies) {
            notes.push({ kind: 'anomaly', title: 'Nouvelle anomalie', body: 'Un appel sans réservation demande un motif.', at, link: '/appels' });
          }
          if (cur.calls > prev.current.calls) {
            notes.push({ kind: 'call', title: 'Appel reçu', body: `${cur.calls - prev.current.calls} appel(s) au journal.`, at, link: '/appels' });
          }
          if (cur.parts > prev.current.parts) {
            notes.push({ kind: 'part', title: 'Pièce en stock', body: `${cur.parts - prev.current.parts} pièce(s) de rechange ajoutée(s) au stock.`, at, link: '/flotte' });
          }
          const freshUsed = usedParts.filter((x) => !prev.current.usedParts.has(x.id));
          if (freshUsed.length > 0) {
            const first = freshUsed[0];
            const engin = first.used_vehicle_plate ? ` — engin ${first.used_vehicle_plate}` : '';
            const more = freshUsed.length > 1 ? ` (+${freshUsed.length - 1})` : '';
            notes.push({ kind: 'part', title: 'Pièce utilisée', body: `${first.name} (${first.serial_number})${engin}${more}.`, at, link: '/flotte' });
          }
          const freshToSign = h.to_sign.filter((x) => !prev.current.hrToSign.has(`${x.type}-${x.id}`));
          if (freshToSign.length > 0) {
            const first = freshToSign[0];
            const more = freshToSign.length > 1 ? ` (+${freshToSign.length - 1})` : '';
            notes.push({ kind: 'hr', title: 'Document à signer', body: `${first.title} — ${first.reference}${more}.`, at, link: '/mes-documents' });
          }
          const freshSigned = h.signed.filter((x) => !prev.current.hrSigned.has(`${x.type}-${x.id}`));
          if (freshSigned.length > 0) {
            const first = freshSigned[0];
            const more = freshSigned.length > 1 ? ` (+${freshSigned.length - 1})` : '';
            notes.push({ kind: 'hr', title: 'Document signé', body: `${first.employee_name} a signé ${first.reference}${more}.`, at, link: '/rh' });
          }
        }
        prev.current = {
          ...cur, usedParts: new Set(usedParts.map((x) => x.id)),
          hrToSign: new Set(h.to_sign.map((x) => `${x.type}-${x.id}`)),
          hrSigned: new Set(h.signed.map((x) => `${x.type}-${x.id}`)),
          init: true,
        };
        if (notes.length > 0) {
          setItems((l) => [...notes, ...l].slice(0, 20));
          setUnread((u) => u + notes.length);
          notes.forEach(pushBrowser);
        }
      } catch { /* hors-ligne : on réessaie */ }
    }
    void poll();
    const t = window.setInterval(poll, 30000);
    return () => { alive = false; window.clearInterval(t); };
  }, [pushBrowser]);

  return <Ctx.Provider value={{ items, unread, readAll, pushBrowser }}>{children}</Ctx.Provider>;
}

export const useNotify = () => useContext(Ctx);
