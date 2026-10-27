import { useEffect, useState } from 'react';

/* Minuteur de sortie : démarré au premier scan (arrivée), calé sur la durée
   de la formule. Persisté en local pour survivre au rechargement. */
export interface RideExtension { minutes: number; reason: string; at: number; }
export interface Ride {
  code: string;
  bookingId: number;
  startedAt: number;
  endsAt: number;
  durationMin: number;
  alerted: boolean;
  extensions?: RideExtension[];
}

const KEY = 'bko.rides';

function readAll(): Record<string, Ride> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Ride>; }
  catch { return {}; }
}

function writeAll(all: Record<string, Ride>): void {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* stockage indisponible */ }
}

export function startRide(bookingId: number, code: string, durationMin: number): Ride {
  const now = Date.now();
  const ride: Ride = {
    code, bookingId, startedAt: now,
    endsAt: now + Math.max(1, durationMin) * 60_000,
    durationMin, alerted: false,
  };
  const all = readAll();
  all[code.toUpperCase()] = ride;
  writeAll(all);
  return ride;
}

export function getRide(code: string): Ride | null {
  return readAll()[code.toUpperCase()] ?? null;
}

export function listRides(): Ride[] {
  return Object.values(readAll()).sort((a, b) => a.endsAt - b.endsAt);
}

export function markAlerted(code: string): void {
  const all = readAll();
  const r = all[code.toUpperCase()];
  if (r) { r.alerted = true; writeAll(all); }
}

export function clearRide(code: string): void {
  const all = readAll();
  delete all[code.toUpperCase()];
  writeAll(all);
}

export function extendRide(code: string, extraMin: number, reason: string): Ride | null {
  const all = readAll();
  const r = all[code.toUpperCase()];
  if (!r) return null;
  const mins = Math.max(1, extraMin);
  r.endsAt += mins * 60_000;
  r.durationMin += mins;
  r.alerted = false;
  r.extensions = r.extensions ?? [];
  r.extensions.push({ minutes: mins, reason: reason.trim(), at: Date.now() });
  writeAll(all);
  return r;
}

export function remainingMs(ride: Ride, now = Date.now()): number {
  return ride.endsAt - now;
}

/* Minuteur reconstitué depuis le serveur (événement d'arrivée) : fonctionne
   même si le scan a été fait depuis un autre téléphone. */
export function rideFromCheckin(
  code: string, bookingId: number, checkinAtISO: string, durationMin: number,
): Ride {
  const startedAt = new Date(checkinAtISO).getTime() || Date.now();
  const mins = Math.max(1, durationMin || 60);
  return {
    code: code.toUpperCase(), bookingId, startedAt,
    endsAt: startedAt + mins * 60_000, durationMin: mins, alerted: true,
  };
}

export function fmtCountdown(ms: number): string {
  if (ms <= 0) return '00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(h).padStart(2, '0') : String(m).padStart(2, '0');
  const ss = h > 0 ? String(m).padStart(2, '0') : String(r).padStart(2, '0');
  const tail = h > 0 ? String(r).padStart(2, '0') : '';
  return h > 0 ? `${mm}:${ss}:${tail}` : `${mm}:${ss}`;
}

/* Horloge partagée : réaffiche les minuteurs sans recharger. */
export function useNow(active: boolean, stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(t);
  }, [active, stepMs]);
  return now;
}
