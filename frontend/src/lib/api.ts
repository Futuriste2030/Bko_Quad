/* Client typé de l'API v1. Base commune pour PWA agence puis app client. */

const BASE = '/api/v1';

export interface Tokens { access: string; refresh: string }
export interface Booking {
  id: number; code: string; customer: number; slot: number;
  persons: number; quads: number; unit_price: number; total: number;
  deposit_due: number; status: string; source: string;
  expires_at: string; qr_token: string; cancel_reason: string;
}

const store = {
  get access(): string | null { return localStorage.getItem('bko.access'); },
  set access(v: string | null) { v ? localStorage.setItem('bko.access', v) : localStorage.removeItem('bko.access'); },
  get refresh(): string | null { return localStorage.getItem('bko.refresh'); },
  set refresh(v: string | null) { v ? localStorage.setItem('bko.refresh', v) : localStorage.removeItem('bko.refresh'); },
};

async function req(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...init.headers as Record<string, string> };
  if (auth && store.access) headers.Authorization = `Bearer ${store.access}`;
  return fetch(`${BASE}${path}`, { ...init, headers });
}

export async function login(username: string, password: string): Promise<void> {
  const r = await req('/auth/token/', { method: 'POST', body: JSON.stringify({ username, password }) }, false);
  if (!r.ok) throw new Error('Identifiants invalides.');
  const t = (await r.json()) as Tokens;
  store.access = t.access;
  store.refresh = t.refresh;
}

export function logout(): void { store.access = null; store.refresh = null; }

export async function listBookings(): Promise<Booking[]> {
  const r = await req('/bookings/');
  if (!r.ok) throw new Error('Chargement impossible, réessayez.');
  const data = await r.json();
  return Array.isArray(data) ? data : data.results ?? [];
}

export async function createBooking(input: { customer: number; slot: number; persons: number; quads?: number; source?: string }): Promise<Booking> {
  const r = await req('/bookings/', { method: 'POST', body: JSON.stringify(input) });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Enregistrement impossible, réessayez.');
  }
  return r.json();
}
