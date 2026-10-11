/* Client typé de l'API v1. Base commune pour PWA agence puis app client. */

const BASE = '/api/v1';

export interface Tokens { access: string; refresh: string }
export interface Booking {
  id: number; code: string; customer: number; slot: number;
  persons: number; quads: number; unit_price: number; total: number;
  deposit_due: number; status: string; source: string;
  expires_at: string; qr_token: string; cancel_reason: string;
}
export interface Slot { id: number; activity: number; start: string; end: string; capacity: number; closed: boolean }
export interface Customer { id: number; name: string; phone: string; whatsapp: string; email: string }
export interface CallItem {
  id: number; direction: string; phone_number: string;
  started_at: string; duration_seconds: number; source: string; external_id: string;
}
export interface Anomaly { id: number; call: number; status: string; reason: string; comment: string }
export interface Closing {
  id: number; date: string; bookings_count: number;
  amount_collected: number; calls_count: number; anomalies_open: number;
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

async function list<T>(path: string): Promise<T[]> {
  const r = await req(path);
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) throw new Error('Chargement impossible, réessayez.');
  const data = await r.json();
  return Array.isArray(data) ? data : data.results ?? [];
}

export async function login(username: string, password: string): Promise<void> {
  const r = await req('/auth/token/', { method: 'POST', body: JSON.stringify({ username, password }) }, false);
  if (!r.ok) throw new Error('Identifiants invalides.');
  const t = (await r.json()) as Tokens;
  store.access = t.access;
  store.refresh = t.refresh;
}

export function logout(): void { store.access = null; store.refresh = null; }

export const listBookings = (): Promise<Booking[]> => list<Booking>('/bookings/');
export const listSlots = (): Promise<Slot[]> => list<Slot>('/slots/');
export const listCustomers = (): Promise<Customer[]> => list<Customer>('/customers/');
export const listCalls = (): Promise<CallItem[]> => list<CallItem>('/calls/');
export const listAnomalies = (): Promise<Anomaly[]> => list<Anomaly>('/anomalies/');

export async function createBooking(input: { customer: number; slot: number; persons: number; quads?: number; source?: string }): Promise<Booking> {
  const r = await req('/bookings/', { method: 'POST', body: JSON.stringify(input) });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Enregistrement impossible, réessayez.');
  }
  return r.json();
}

export async function createCustomer(input: { name: string; phone: string }): Promise<Customer> {
  const r = await req('/customers/', { method: 'POST', body: JSON.stringify(input) });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    const first = err.phone?.[0] ?? err.name?.[0] ?? err.detail;
    throw new Error(first ?? 'Client impossible à créer.');
  }
  return r.json();
}

export async function reconcileCall(id: number): Promise<{ booking: Booking | null; anomaly: Anomaly | null }> {
  const r = await req(`/calls/${id}/reconcile/`, { method: 'POST', body: '{}' });
  if (!r.ok) throw new Error('Rapprochement impossible.');
  return r.json();
}

export async function resolveAnomaly(id: number, reason: string, comment = ''): Promise<Anomaly> {
  const r = await req(`/anomalies/${id}/resolve/`, { method: 'POST', body: JSON.stringify({ reason, comment }) });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Motif obligatoire pour clore.');
  }
  return r.json();
}

export async function validateClosing(date: string): Promise<Closing> {
  const r = await req('/closings/validate/', { method: 'POST', body: JSON.stringify({ date }) });
  if (!r.ok) throw new Error('Clôture impossible.');
  return r.json();
}

export async function createPayLink(booking: number): Promise<{ reference: string; amount: number }> {
  const r = await req('/payments/link/', { method: 'POST', body: JSON.stringify({ booking }) });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Lien de paiement impossible.');
  }
  return r.json();
}

export async function logMessage(booking: number, text: string): Promise<{ wa_me: string }> {
  const r = await req('/messages/', { method: 'POST', body: JSON.stringify({ booking, text }) });
  if (!r.ok) throw new Error('Journalisation impossible.');
  return r.json();
}

export async function cancelBooking(id: number, reason: string): Promise<Booking> {
  const r = await req(`/bookings/${id}/cancel/`, { method: 'POST', body: JSON.stringify({ reason }) });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Annulation impossible.');
  }
  return r.json();
}

export function todayISO(): string { return new Date().toISOString().slice(0, 10); }
export function draftKey(): string { return 'bko.draft'; }
export function saveDraft(d: string): void { try { localStorage.setItem(draftKey(), d); } catch { /* stockage indisponible */ } }
export function loadDraft(): string | null { try { return localStorage.getItem(draftKey()); } catch { return null; } }
export function clearDraft(): void { try { localStorage.removeItem(draftKey()); } catch { /* stockage indisponible */ } }
