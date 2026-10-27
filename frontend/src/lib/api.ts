/* Client typé de l'API v1. Base commune pour PWA agence puis app client.
   J : le réseau peut tomber — une écriture partie sans réseau est mise en file
   locale et rejouée au retour (clé d'idempotence), une lecture revient du cache. */

import {
  allocLocalId, cacheClear, cacheGet, cacheSet, enqueueOp, allOps,
  markOpFailed, pendingCount, removeOp, resolveRefs, uuid, type OpKind,
} from './offline';

const BASE = '/api/v1';
const TIMEOUT_MS = 20000;

/* Contexte site de l'URL (/s/2/...). Les rôles de terrain sont de toute
   façon verrouillés côté serveur ; les profils globaux (direction,
   superadmin, comptable) utilisent ce segment pour filtrer leurs lectures
   et rattacher leurs écritures. */
export function activeSiteId(): number | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/^\/s\/(\d+)(?:\/|$)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/* Ajoute `site=` à la requête (lecture et écriture). Exceptions : catalogue
   des sites (le sélecteur doit lister tout le réseau) et exports (paramètre
   explicite). Les appels et anomalies sont désormais filtrables par site. */
function withSite(path: string): string {
  const site = activeSiteId();
  if (site === null) return path;
  if (path.startsWith('/sites/') || path.startsWith('/exports/')) return path;
  if (path.startsWith('/auth/') || path.startsWith('/company/') || path.startsWith('/version/')) return path;
  if (/[?&]site=/.test(path)) return path;
  return `${path}${path.includes('?') ? '&' : '?'}site=${site}`;
}

export interface Tokens { access: string; refresh: string }
export interface Me {
  id: number; username: string; first_name: string; last_name: string;
  phone: string; role: string; site: number | null; site_name: string;
  totp_enabled: boolean; is_superuser: boolean;
}
export interface BookingLine {
  rank: number; persons: number; quads: number; line_total: number; discount?: number;
}
export interface Booking {
  id: number; code: string; customer: number; slot: number;
  site?: number; site_name?: string;
  persons: number; quads: number; resource_type?: 'quad' | 'velo';
  unit_price: number; total: number;
  deposit_due: number; status: string; source: string;
  expires_at: string; qr_token: string; cancel_reason: string;
  units?: number;
  discount_total?: number;
  lines?: BookingLine[];
  vehicle_plates?: string[];
  /* J : saisie encore locale (à synchroniser). */
  queued?: boolean;
}
export interface Slot { id: number; activity: number; start: string; end: string; capacity: number; closed: boolean; vehicles?: number[] }
export interface FleetAvailability {
  slot: number; resource_type: 'quad' | 'velo'; total: number; used: number; free: number;
}
export interface Customer {
  id: number; name: string; phone: string; whatsapp: string; email: string;
  site?: number | null; site_name?: string; queued?: boolean;
}
export interface CallItem {
  id: number; direction: string; phone_number: string;
  started_at: string; duration_seconds: number; source: string; external_id: string;
  line: number | null; line_label: string; site: number | null; site_name: string;
  imported_by: number | null; imported_by_name: string;
}
export interface Anomaly { id: number; call: number; status: string; reason: string; comment: string; queued?: boolean }
export interface Closing {
  id: number; date: string; bookings_count: number;
  amount_collected: number; calls_count: number; anomalies_open: number;
  validated_at: string;
}
export interface ClosingDay {
  date: string; closed: boolean; closing_hour: number; closing: Closing | null;
}

const store = {
  get access(): string | null { return localStorage.getItem('bko.access'); },
  set access(v: string | null) { v ? localStorage.setItem('bko.access', v) : localStorage.removeItem('bko.access'); },
  get refresh(): string | null { return localStorage.getItem('bko.refresh'); },
  set refresh(v: string | null) { v ? localStorage.setItem('bko.refresh', v) : localStorage.removeItem('bko.refresh'); },
};

/* J : le compte courant (les saisies en file lui appartiennent). */
let currentUserId: number | null = null;
export function setCurrentUser(id: number | null): void { currentUserId = id; }
export function getCurrentUserId(): number | null { return currentUserId; }

/* J : réseau indisponible (≠ refus métier). */
export class NetworkError extends Error {
  constructor(message = 'Réseau indisponible.') { super(message); this.name = 'NetworkError'; }
}

async function req(path: string, init: RequestInit = {}, auth = true, retried = false): Promise<Response> {
  const target = withSite(path);
  /* Multipart (photo d'engin) : le navigateur fixe lui-même le Content-Type. */
  const isForm = init.body instanceof FormData;
  const headers: Record<string, string> = isForm
    ? { ...init.headers as Record<string, string> }
    : { 'Content-Type': 'application/json', ...init.headers as Record<string, string> };
  if (auth && store.access) headers.Authorization = `Bearer ${store.access}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch(`${BASE}${target}`, { ...init, headers, signal: ctrl.signal });
  } catch {
    throw new NetworkError('Réseau indisponible : la saisie est conservée sur ce téléphone.');
  } finally {
    clearTimeout(timer);
  }
  /* Session : l'access expire vite (15 min). Renouvellement silencieux via
     le refresh avant de déclarer la session expirée (une seule tentative). */
  if (auth && r.status === 401 && !retried && store.refresh) {
    try {
      const rr = await fetch(`${BASE}/auth/refresh/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: store.refresh }),
      });
      if (rr.ok) {
        store.access = ((await rr.json()) as Tokens).access;
        return req(path, init, auth, true);
      }
    } catch { /* refresh impossible : 401 propagé, déconnexion par l'appelant */ }
  }
  return r;
}

async function list<T>(path: string): Promise<T[]> {
  const key = withSite(path);
  let r: Response;
  try {
    r = await req(path);
  } catch (e) {
    /* J : hors ligne, on rend la dernière version connue (cache local). */
    if (e instanceof NetworkError) {
      const cached = await cacheGet<T[]>(key);
      if (cached) return cached;
      throw new Error('Hors ligne : cette liste n’a jamais été consultée sur ce téléphone.');
    }
    throw e;
  }
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) throw new Error('Chargement impossible, réessayez.');
  const data = await r.json();
  const out = (Array.isArray(data) ? data : data.results ?? []) as T[];
  void cacheSet(key, out);
  return out;
}

/* 2FA active : le serveur refuse la connexion sans code à 6 chiffres. */
export class TotpRequiredError extends Error {
  constructor(message: string) { super(message); this.name = 'TotpRequiredError'; }
}

export async function login(username: string, password: string, otp = ''): Promise<void> {
  let r: Response;
  try {
    r = await req('/auth/token/', { method: 'POST', body: JSON.stringify({ username, password, otp }) }, false);
  } catch (e) {
    /* J : l'identification exige le Hub (une session hors ligne ne s'invente pas). */
    if (e instanceof NetworkError) throw new Error('Réseau indisponible : la connexion exige le Hub.');
    throw e;
  }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    if (err.totp_required) throw new TotpRequiredError(err.detail ?? 'Code de double authentification requis.');
    throw new Error(err.detail ?? 'Identifiants invalides.');
  }
  const t = (await r.json()) as Tokens;
  store.access = t.access;
  store.refresh = t.refresh;
}

export function logout(): void {
  store.access = null;
  store.refresh = null;
  setCurrentUser(null);
  localStorage.removeItem('bko.me');
  /* J : le cache de lecture part avec la session (données d'un autre compte),
     la file d'attente reste (elle appartient aux saisies à rejouer). */
  void cacheClear();
}

export function isLoggedIn(): boolean { return !!store.access; }

export async function fetchMe(): Promise<Me> {
  let r: Response;
  try {
    r = await req('/auth/me/');
  } catch (e) {
    /* J : hors ligne, le profil en cache évite de fermer la session. */
    if (e instanceof NetworkError) {
      const cached = cachedMe();
      if (cached) { setCurrentUser(cached.id); return cached; }
      throw e;
    }
    throw e;
  }
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) throw new Error('Profil inaccessible.');
  const me = (await r.json()) as Me;
  setCurrentUser(me.id);
  try { localStorage.setItem('bko.me', JSON.stringify(me)); } catch { /* stockage indisponible */ }
  return me;
}

export function cachedMe(): Me | null {
  try {
    const raw = localStorage.getItem('bko.me');
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

/* --- J : écritures hors ligne (file d'attente + rejeu idempotent) ------- */

function errorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'string' && err.trim()) return err;
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    if (typeof o.detail === 'string' && o.detail.trim()) return o.detail;
    const flat = Object.values(o).flat().filter((v) => typeof v === 'string') as string[];
    if (flat.length) return flat[0];
  }
  return fallback;
}

interface QueueMeta {
  kind: OpKind;
  label: string;
  meta?: Record<string, string | number>;
  localId?: number;
  offlineBody?: unknown;
}

function hasLocalRef(value: unknown): boolean {
  if (typeof value === 'number') return value < 0;
  if (Array.isArray(value)) return value.some(hasLocalRef);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasLocalRef);
  }
  return false;
}

/* Écriture : en ligne elle part au Hub ; hors ligne elle part en file locale
   (clé d'idempotence) et sera rejouée au retour du réseau.
   La clé d'idempotence est envoyée DÈS l'appel en ligne : si la réponse se
   perd (coupure), le rejeu retrouve la même écriture au lieu d'en créer une
   deuxième. */
async function postOrQueue<T>(path: string, body: unknown, q: QueueMeta): Promise<{ data: T | null; queued: boolean }> {
  const key = uuid();
  const headers = { 'Idempotency-Key': key };
  /* Site figé à la saisie : un rejeu depuis un autre contexte garde le bon. */
  const target = withSite(path);
  /* Une saisie liée à une autre saisie locale ne peut pas partir seule. */
  if (!hasLocalRef(body)) {
    try {
      const r = await req(target, { method: 'POST', headers, body: JSON.stringify(body) });
      if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(errorMessage(err, 'Opération impossible, réessayez.'));
      }
      return { data: (await r.json()) as T, queued: false };
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
    }
  }
  await enqueueOp({
    id: key,
    method: 'POST', path: target, body: q.offlineBody ?? body,
    kind: q.kind, label: q.label, meta: q.meta, localId: q.localId, owner: currentUserId,
  });
  return { data: null, queued: true };
}

export interface SyncReport {
  sent: number;
  failed: number;
  needLogin: boolean;
  remaining: number;
}

/* Rejeu de la file : une écriture à la fois, dans l'ordre de saisie.
   - 2xx : la saisie est faite (idempotence serveur : un rejeu ne double pas) ;
   - 4xx : refus métier, la saisie est mise en attente d'arbitrage humain ;
   - 425 : traitement en cours, on retentera plus tard ;
   - 401 : session à renouveler, la file est conservée. */
export async function flushQueue(): Promise<SyncReport> {
  const ops = (await allOps()).filter((o) => o.status === 'pending');
  const created = new Map<string, any>();
  let sent = 0;
  let failed = 0;
  let needLogin = false;
  for (const op of ops) {
    if (op.owner !== null && op.owner !== undefined && op.owner !== currentUserId) continue;
    let body: unknown;
    try {
      body = resolveRefs(op.body, created);
    } catch {
      await markOpFailed(op.id, 'Saisie liée non synchronisée : la saisie d’origine a échoué.');
      failed += 1;
      continue;
    }
    let r: Response;
    try {
      r = await req(op.path, {
        method: 'POST',
        headers: {
          'Idempotency-Key': op.id,
          'X-Offline-At': op.createdAt,
          'X-Offline-Label': encodeURIComponent(op.label),
        },
        body: JSON.stringify(body),
      });
    } catch {
      break; // réseau toujours coupé : on retentera
    }
    if (r.status === 401) { needLogin = true; break; }
    if (r.status === 425) { break; }
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      created.set(op.id, data);
      await removeOp(op.id);
      sent += 1;
    } else {
      const detail = (data as { detail?: string }).detail;
      await markOpFailed(op.id, detail ?? 'Refus du Hub.');
      failed += 1;
    }
  }
  return { sent, failed, needLogin, remaining: await pendingCount() };
}

/* Code proposé par l'appareil : même format que le Hub, garde-fou si deux
   téléphones saisissent la même minute. */
export function proposeCode(): string {
  const day = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 4; i += 1) rand += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `BKO-${day}-${rand}`;
}

export const listBookings = (): Promise<Booking[]> => list<Booking>('/bookings/');
export interface BookingEventItem {
  id: number; booking: number; actor: number | null; action: string;
  before: unknown; after: unknown; created_at: string;
}

export const listBookingEvents = (): Promise<BookingEventItem[]> => list<BookingEventItem>('/booking-events/');
export const listSlots = (): Promise<Slot[]> => list<Slot>('/slots/');
export const listCustomers = (): Promise<Customer[]> => list<Customer>('/customers/');
export const listCalls = (): Promise<CallItem[]> => list<CallItem>('/calls/');
export const listAnomalies = (): Promise<Anomaly[]> => list<Anomaly>('/anomalies/');

export async function getAvailability(slot: number, activity?: number): Promise<FleetAvailability> {
  const query = `slot=${slot}${activity ? `&activity=${activity}` : ''}`;
  const r = await req(`/bookings/availability/?${query}`);
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Disponibilité de la flotte indisponible.');
  }
  return r.json() as Promise<FleetAvailability>;
}

export async function createBooking(input: { customer: number; slot: number; persons: number; quads?: number; source?: string; activity?: number; lines?: { persons: number; quads: number }[]; previewTotal?: number; customerLabel?: string; call?: number | null }): Promise<Booking> {
  /* J : code proposé par l'appareil (le Hub le garde s'il est libre) + heure
     de saisie tracée. Hors ligne, la réservation reste « à synchroniser ». */
  const localId = await allocLocalId();
  const code = proposeCode();
  const body = {
    customer: input.customer, slot: input.slot, persons: input.persons, quads: input.quads ?? 1,
    source: input.source ?? 'phone', activity: input.activity, lines: input.lines,
    call: input.call ?? null,
  };
  const r = await postOrQueue<Booking>('/bookings/', body, {
    kind: 'booking',
    label: `Réservation ${code}`,
    localId,
    meta: { code, total: input.previewTotal ?? 0, persons: input.persons, customer: input.customerLabel ?? '' },
    offlineBody: { ...body, code, offline_at: new Date().toISOString() },
  });
  if (r.queued) {
    return {
      id: localId, code, customer: input.customer, slot: input.slot, persons: input.persons,
      quads: input.quads ?? 1, unit_price: 0, total: input.previewTotal ?? 0, deposit_due: 0,
      status: 'pending_deposit', source: input.source ?? 'phone',
      expires_at: new Date(Date.now() + 240 * 60000).toISOString(),
      qr_token: '', cancel_reason: '', queued: true,
    };
  }
  return r.data!;
}

export async function createCustomer(input: { name: string; phone: string; whatsapp?: string }): Promise<Customer> {
  const localId = await allocLocalId();
  const r = await postOrQueue<Customer>('/customers/', input, {
    kind: 'customer',
    label: `Client ${input.name}`,
    localId,
    meta: { name: input.name, phone: input.phone },
  });
  if (r.queued) {
    return { id: localId, name: input.name, phone: input.phone, whatsapp: input.whatsapp ?? '', email: '', queued: true };
  }
  return r.data!;
}

export async function reconcileCall(id: number): Promise<{ booking: Booking | null; anomaly: Anomaly | null }> {
  const r = await req(`/calls/${id}/reconcile/`, { method: 'POST', body: '{}' });
  if (!r.ok) throw new Error('Rapprochement impossible.');
  return r.json();
}

export async function resolveAnomaly(id: number, reason: string, comment = ''): Promise<Anomaly> {
  /* J : la justification d'un appel peut être faite sans réseau (motif
     obligatoire, rejoué au retour — l'anomalie reste ouverte jusque-là). */
  const r = await postOrQueue<Anomaly>(`/anomalies/${id}/resolve/`, { reason, comment }, {
    kind: 'anomaly',
    label: `Anomalie #${id} — ${reason}`,
    meta: { id, reason },
  });
  if (r.queued) return { id, call: 0, status: 'open', reason, comment, queued: true };
  return r.data!;
}

export async function getClosingDay(date: string): Promise<ClosingDay> {
  const r = await req(`/closings/?date=${date}`);
  if (!r.ok) throw new Error('Bordereau du jour indisponible.');
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
  const r = await postOrQueue<{ wa_me: string }>('/messages/', { booking, text }, {
    kind: 'message',
    label: 'Message client',
    meta: { booking },
  });
  /* Hors ligne, le lien WhatsApp part avec la saisie (le booking n'existe pas
     encore côté Hub) : il sera produit à la synchronisation. */
  if (r.queued) return { wa_me: '' };
  return r.data!;
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

/* Catalogue, documents, caisse, check-in — mêmes règles serveur, mêmes rôles. */
export interface Activity {
  id: number; site: number; name: string; duration_minutes: number;
  base_price: number; deposit: number; max_group: number;
}
export interface Site { id: number; name: string; city: string }
export interface Invoice { id: number; booking: number; number: number; issued_at: string; queued?: boolean }
export interface Payment {
  id: number; booking: number; nature: string; mode: string;
  amount: number; reference: string; status: string; paid_at: string;
}

export interface ActivityInput {
  site: number; name: string; duration_minutes: number;
  base_price: number; deposit: number; max_group: number;
}
export const listActivities = (site?: number): Promise<Activity[]> =>
  list<Activity>(site ? `/activities/?site=${site}` : '/activities/');
export const listSites = (): Promise<Site[]> => list<Site>('/sites/');
export async function createActivity(input: ActivityInput): Promise<Activity> {
  return postOne<Activity>('/activities/', input);
}
export async function updateActivity(id: number, input: Partial<ActivityInput>): Promise<Activity> {
  return patchOne<Activity>(`/activities/${id}/`, input);
}
export async function deleteActivity(id: number): Promise<void> {
  const r = await req(`/activities/${id}/`, { method: 'DELETE' });
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Suppression impossible (formule utilisée par des créneaux).');
  }
}

async function postOne<T>(path: string, body: unknown): Promise<T> {
  const r = await req(path, { method: 'POST', body: JSON.stringify(body) });
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(errorMessage(err, 'Opération impossible, réessayez.'));
  }
  return r.json();
}

export async function createSite(input: { name: string; city?: string }): Promise<Site> {
  return postOne<Site>('/sites/', input);
}
export async function deleteSite(id: number): Promise<void> {
  const r = await req(`/sites/${id}/`, { method: 'DELETE' });
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Suppression impossible (site utilisé).');
  }
}

export async function createSlot(input: { activity: number; start: string; end: string; capacity: number }): Promise<Slot> {
  return postOne<Slot>('/slots/', input);
}

export async function issueInvoice(booking: number): Promise<Invoice> {
  /* J : la facture peut être demandée sans réseau ; le numéro est attribué
     par le Hub à la synchronisation. */
  const localId = await allocLocalId();
  const r = await postOrQueue<Invoice>('/payments/invoice/', { booking }, {
    kind: 'invoice',
    label: `Facture réservation #${booking}`,
    localId,
    meta: { booking },
  });
  if (r.queued) {
    return { id: localId, booking, number: 0, issued_at: new Date().toISOString(), queued: true };
  }
  return r.data!;
}

export async function recordCash(booking: number, amount: number, nature: 'deposit' | 'balance' = 'balance'): Promise<{ payment: Payment; booking: Booking; reference: string; queued?: boolean }> {
  /* J : l'encaissement espèces se consigne hors ligne. La réservation n'est
     confirmée qu'au rejeu (règle : confirmation = réservation + paiement reçu
     et tracé dans le Hub). */
  const localId = await allocLocalId();
  const r = await postOrQueue<{ payment: Payment; booking: Booking; reference: string }>(
    '/payments/cash/', { booking, amount, nature }, {
      kind: 'cash',
      label: `Encaissement ${amount} FCFA`,
      localId,
      meta: { booking, amount, nature },
    });
  if (r.queued) {
    return {
      payment: { id: localId, booking, nature, mode: 'cash', amount, reference: 'à synchroniser', status: 'paid', paid_at: new Date().toISOString() },
      booking: { id: booking, code: '', customer: 0, slot: 0, persons: 0, quads: 0, unit_price: 0, total: amount, deposit_due: 0, status: 'pending_deposit', source: 'onsite', expires_at: '', qr_token: '', cancel_reason: '', queued: true },
      reference: 'à synchroniser',
      queued: true,
    };
  }
  return r.data!;
}

export const listPayments = (): Promise<Payment[]> => list<Payment>('/payments/');
export const listInvoices = (): Promise<Invoice[]> => list<Invoice>('/invoices/');

export async function checkInBooking(id: number): Promise<Booking> {
  return postOne<Booking>(`/bookings/${id}/check_in/`, {});
}

export async function completeBooking(id: number): Promise<Booking> {
  return postOne<Booking>(`/bookings/${id}/complete/`, {});
}

export async function noShowBooking(id: number): Promise<Booking> {
  return postOne<Booking>(`/bookings/${id}/no_show/`, {});
}

export async function expireBooking(id: number): Promise<Booking> {
  return postOne<Booking>(`/bookings/${id}/expire/`, {});
}

/* Normalisation locale : compare les 8 derniers chiffres (ex. +223 XX XX XX XX). */
export function samePhone(a: string, b: string): boolean {
  const da = a.replace(/\D/g, '').slice(-8);
  const db = b.replace(/\D/g, '').slice(-8);
  return da.length === 8 && da === db;
}

/* Flotte, finance manuelle, entreprise, communication, comptes. */
export interface Vehicle {
  id: number; site: number; site_name: string; type: string; model: string;
  plate: string; color: string; photo: string | null; status: string; created_at: string;
}
export interface Maintenance {
  id: number; vehicle: number; plate: string; kind: string; date: string;
  cost: number; part_name: string; part_serial: string;
  oil_liters: string | null; quantity: number | null;
  notes: string; new_status: string; created_by: number | null;
}
export interface SparePart {
  id: number; site: number; site_name: string; name: string; serial_number: string;
  color: string; reason: string; bought_on: string;
  added_by: number | null; added_by_name: string;
  status: 'available' | 'used'; used_at: string | null;
  used_in: number | null; used_vehicle_plate: string; used_vehicle_model: string;
  used_on: string | null; created_at: string;
}
export interface Entry {
  id: number; date: string; site: number | null; site_name: string; category: string;
  label: string; voucher: string; direction: 'in' | 'out'; amount: number;
  payment: number | null; booking: number | null; receipt: string; locked: boolean;
  created_at: string; queued?: boolean;
}
export interface MonthSummary {
  month: string; opening: number; inn: number; out: number; balance: number; locked: boolean;
}
export interface AdminUser {
  id: number; username: string; first_name: string; last_name: string;
  phone: string; role: string; site: number | null; site_name: string;
  is_active: boolean; totp_enabled: boolean; is_superuser: boolean;
}
export interface HRUser {
  id: number; username: string; name: string; role: string;
  role_label: string; is_superuser: boolean;
}
export interface Company {
  id: number; name: string; phone: string; email: string; address: string;
  nif: string; rccm: string; conditions: string; thanks: string;
  stamp: string | null; signature: string | null; signature_name: string;
}
export interface Notice {
  id: number; type: 'communique' | 'lettre'; title: string; content: string;
  site?: number | null; site_name?: string;
  status: 'draft' | 'published'; published_at: string | null; created_at: string; created_by: number | null;
}

export const listVehicles = (): Promise<Vehicle[]> => list<Vehicle>('/vehicles/');
export const listMaintenances = (): Promise<Maintenance[]> => list<Maintenance>('/maintenances/');
export const listSpareParts = (): Promise<SparePart[]> => list<SparePart>('/parts/');
export const listEntries = (): Promise<Entry[]> => list<Entry>('/entries/');
export const updateEntry = (id: number, input: Partial<{ date: string; label: string; amount: number; category: string; site: number | null; receipt: string }>): Promise<Entry> =>
  patchOne<Entry>(`/entries/${id}/`, input);
export const listNotices = (): Promise<Notice[]> => list<Notice>('/notices/');
export const listUsers = (): Promise<AdminUser[]> => list<AdminUser>('/users/');
export const listHRUsers = (): Promise<HRUser[]> => list<HRUser>('/hr/accounts/');

async function putOne<T>(path: string, body: unknown): Promise<T> {
  const r = await req(path, { method: 'PUT', body: JSON.stringify(body) });
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Enregistrement impossible.');
  }
  return r.json();
}

async function patchOne<T>(path: string, body: unknown): Promise<T> {
  const r = await req(path, { method: 'PATCH', body: JSON.stringify(body) });
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    const first = typeof err === 'object' && err !== null
      ? Object.values(err as Record<string, unknown>).flat().join(' ') : '';
    throw new Error((first as string) || 'Enregistrement impossible.');
  }
  return r.json();
}

export async function createVehicle(input: { site: number; type: string; model: string; plate: string; color?: string; status?: string; photo?: File }): Promise<Vehicle> {
  /* Photo : multipart (le serveur convertit en WebP). Sinon JSON. */
  if (input.photo) {
    const fd = new FormData();
    fd.set('site', String(input.site));
    fd.set('type', input.type);
    fd.set('model', input.model);
    fd.set('plate', input.plate);
    if (input.color) fd.set('color', input.color);
    if (input.status) fd.set('status', input.status);
    fd.set('photo', input.photo);
    const r = await req('/vehicles/', { method: 'POST', body: fd });
    if (!r.ok) {
      const err: Record<string, unknown> = await r.json().catch(() => ({}));
      if (err.photo) {
        const ph = err.photo as unknown;
        throw new Error(Array.isArray(ph) ? String(ph[0]) : String(ph));
      }
      throw new Error(String((err.detail as string) ?? '') || 'Enregistrement impossible.');
    }
    return r.json();
  }
  return postOne<Vehicle>('/vehicles/', input);
}

export async function createMaintenance(input: { vehicle: number; kind: string; date: string; cost?: number; part_name?: string; part_serial?: string; oil_liters?: number | null; quantity?: number | null; notes?: string; new_status?: string }): Promise<Maintenance> {
  return postOne<Maintenance>('/maintenances/', input);
}

export async function createSparePart(input: {
  site: number; name: string; serial_number: string; color?: string;
  reason: string; bought_on?: string;
}): Promise<SparePart> {
  return postOne<SparePart>('/parts/', input);
}

export async function deleteSparePart(id: number): Promise<void> {
  const r = await req(`/parts/${id}/`, { method: 'DELETE' });
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Suppression impossible (pièce déjà utilisée en maintenance).');
  }
}

export async function deleteVehicle(id: number): Promise<void> {
  const r = await req(`/vehicles/${id}/`, { method: 'DELETE' });
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Suppression impossible (engin utilisé : passez-le hors service).');
  }
}

export async function updateSlotVehicles(id: number, vehicles: number[]): Promise<Slot> {
  return patchOne<Slot>(`/slots/${id}/`, { vehicles });
}

export async function deleteSlot(id: number): Promise<void> {
  const r = await req(`/slots/${id}/`, { method: 'DELETE' });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Ce créneau ne peut pas être supprimé.');
  }
}

export async function createExpense(input: { day?: string; direction?: 'in' | 'out'; category: string; label: string; amount: number; site?: number; receipt?: string }): Promise<Entry> {
  /* J : dépense ou recette saisie sans réseau : l'écriture part en file et
     rejoint la caisse au rejeu (montant entier, catégorie et libellé tracés). */
  const localId = await allocLocalId();
  const r = await postOrQueue<Entry>('/finance/expense/', input, {
    kind: 'expense',
    label: `${input.direction === 'in' ? 'Recette' : 'Dépense'} — ${input.label} (${input.amount} FCFA)`,
    localId,
    meta: { label: input.label, amount: input.amount, category: input.category },
  });
  if (r.queued) {
    return {
      id: localId, date: input.day ?? new Date().toISOString().slice(0, 10),
      site: input.site ?? null, site_name: '', category: input.category, label: input.label,
      voucher: '', direction: input.direction ?? 'out', amount: input.amount,
      payment: null, booking: null, receipt: input.receipt ?? '', locked: false,
      created_at: new Date().toISOString(), queued: true,
    };
  }
  return r.data!;
}
export async function monthSummary(year: number, month: number): Promise<MonthSummary> {
  const r = await req(`/finance/month/?year=${year}&month=${month}`);
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) throw new Error('Résumé indisponible.');
  return r.json();
}

export async function closeMonth(year: number, month: number): Promise<{ month: string; opening: number; closing: number; locked: boolean }> {
  const r = await req(`/finance/month/close/`, { method: 'POST', body: JSON.stringify({ year, month }) });
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Clôture impossible.');
  }
  return r.json();
}

/* Banque (compte distinct de la caisse) : versements, retraits, virements, rapprochement. */
export type BankType = 'deposit' | 'withdrawal' | 'transfer';
export interface BankTx {
  id: number; type: BankType; amount: number; date: string;
  reason: string; bank: string; counterparty_bank: string;
  receipt_number: string; check_number: string;
  person_first_name: string; person_last_name: string;
  locked: boolean; created_at: string;
}
export interface BankRow {
  id: number; date: string; type: BankType; reason: string;
  ref: string; bank: string; counterparty_bank: string;
  person_first_name: string; person_last_name: string;
  site: number | null; site_name: string;
  debit: number; credit: number; running: number;
}
export interface BankSummary {
  month: string; balance: number; bank: string | null; deposits: number; withdrawals: number;
  net: number; rows: BankRow[];
  site: number | null; site_name: string; site_balance: number | null;
}

export const listBankTxs = (bank?: string, type?: string): Promise<BankTx[]> =>
  list<BankTx>(`/bank-transactions/${bank || type ? `?${[bank ? `bank=${encodeURIComponent(bank)}` : '', type ? `type=${type}` : ''].filter(Boolean).join('&')}` : ''}`);

export async function bankSummary(year: number, month: number, bank?: string): Promise<BankSummary> {
  const r = await req(`/bank/summary/?year=${year}&month=${month}${bank ? `&bank=${encodeURIComponent(bank)}` : ''}`);
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) throw new Error('Résumé bancaire indisponible.');
  return r.json();
}

export async function createDeposit(input: {
  date?: string; reason: string; amount: number; bank: string;
  person_first_name: string; person_last_name: string; receipt_number: string;
}): Promise<BankTx & { balance: number }> {
  return postOne<BankTx & { balance: number }>('/bank/deposit/', input);
}

export async function createWithdrawal(input: {
  date?: string; reason: string; amount: number; bank: string;
  person_first_name: string; person_last_name: string; check_number: string;
}): Promise<BankTx & { balance: number }> {
  return postOne<BankTx & { balance: number }>('/bank/withdrawal/', input);
}

export async function createTransfer(input: {
  date?: string; reason: string; amount: number; bank: string; counterparty_bank: string;
  person_first_name: string;
}): Promise<BankTx & { balance: number }> {
  return postOne<BankTx & { balance: number }>('/bank/transfer/', input);
}

/* Correction a posteriori : fige les N° d'engins (anciens reçus), tracée serveur. */
export async function setBookingVehicles(id: number, vehicles: number[]): Promise<Booking> {
  return postOne<Booking>(`/bookings/${id}/vehicles/`, { vehicles });
}

/* Exports Excel/CSV : période, site, activité et agent (selon le jeu). */
export type ExportFormat = 'csv' | 'xlsx';
export interface ExportQuery {
  dataset: string; start: string; end: string;
  site?: string; activity?: string; agent?: string;
}

function exportFilename(header: string | null, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

export async function downloadExport(query: ExportQuery, format: ExportFormat): Promise<void> {
  const params = new URLSearchParams({
    dataset: query.dataset, file: format, start: query.start, end: query.end,
  });
  if (query.site) params.set('site', query.site);
  if (query.activity) params.set('activity', query.activity);
  const agent = query.agent?.trim();
  if (agent) params.set('agent', agent);
  const r = await req(`/exports/?${params.toString()}`);
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(errorMessage(err, 'Export indisponible.'));
  }
  const blob = await r.blob();
  const fallback = `bko-${query.dataset}-${query.start}_${query.end}.${format}`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = exportFilename(r.headers.get('Content-Disposition'), fallback);
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

/* Téléchargement PDF serveur (reçu, facture, rapport bancaire) : blob + nom. */
export async function downloadPdf(url: string, filename: string): Promise<void> {
  const token = localStorage.getItem('bko.access') ?? '';
  const fullUrl = `/api/v1${withSite(url)}${withSite(url).includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  /* Repli direct : lien avec jeton, pour les WebViews ou fetch+blob ne fonctionne pas. */
  const link = document.createElement('a');
  link.href = fullUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link); link.click(); link.remove();
  /* Tentative via fetch+blob pour les navigateurs (partage natif, etc.). */
  try {
    const r = await fetch(`/api/v1${withSite(url)}`, { headers: authHeaders() });
    if (r.status === 401) { logout(); throw new Error('Session expiree, reconnectez-vous.'); }
    if (!r.ok) throw new Error('Document indisponible.');
    const blob = await r.blob();
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function'
        && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); } catch { /* annulation */ }
    }
  } catch { /* repli sur le lien direct deja clique */ }
}

export interface TrackedLine { id: number; label: string; number: string; site: number | null; site_name: string; active: boolean; collect_enabled: boolean; last_sync: string | null }

export const listLines = (): Promise<TrackedLine[]> => list<TrackedLine>('/lines/');

export async function toggleCollect(id: number, enabled: boolean): Promise<TrackedLine> {
  return patchOne<TrackedLine>(`/lines/${id}/`, { collect_enabled: enabled });
}

export async function createLine(input: { label: string; number: string; site?: number | null }): Promise<TrackedLine> {
  return postOne<TrackedLine>('/lines/', input);
}

export async function importCalls(line_id: number, calls: Array<{ direction: string; phone_number: string; started_at: string; duration_seconds: number; external_id: string }>): Promise<{ created: number; skipped: number; updated: number; last_sync: string | null }> {
  return postOne('/calls/import/', { line_id, calls });
}

export const isNativeCollector = (): boolean =>
  typeof window !== 'undefined' && (window as unknown as { BkoQuad?: { isNativeApp?: boolean } }).BkoQuad?.isNativeApp === true;

export async function toggleLine(id: number, active: boolean): Promise<TrackedLine> {
  return patchOne<TrackedLine>(`/lines/${id}/`, { active });
}

export async function createUser(input: {
  username: string; phone: string; role: string; password: string;
  first_name?: string; last_name?: string; site?: number;
}): Promise<AdminUser> {
  return postOne<AdminUser>('/users/', input);
}

export async function updateMe(input: { first_name?: string; last_name?: string; phone?: string }): Promise<Me> {
  return patchOne<Me>('/auth/me/', input);
}

export async function resetUserPassword(id: number, password: string): Promise<void> {
  await postOne<{ detail: string }>(`/users/${id}/reset_password/`, { password });
}

/* Désactivation / réactivation : le compte est conservé (audit), seul l'accès est coupé. */
export async function toggleUserActive(id: number, active: boolean): Promise<AdminUser> {
  return patchOne<AdminUser>(`/users/${id}/`, { is_active: active });
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await postOne<{ detail: string }>('/auth/password/', { old_password: oldPassword, new_password: newPassword });
}

export async function totpEnroll(): Promise<{ secret: string; otpauth_url: string }> {
  return postOne<{ secret: string; otpauth_url: string }>('/auth/totp/enroll/', {});
}

export async function totpVerify(code: string): Promise<void> {
  await postOne<{ detail: string }>('/auth/totp/verify/', { code });
}

export async function getCompany(): Promise<Company> {
  const r = await req('/company/');
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) throw new Error('Fiche entreprise indisponible.');
  return r.json();
}

export async function getVersion(): Promise<string> {
  const r = await req('/version/');
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) throw new Error('Version indisponible.');
  const data = await r.json();
  return String(data.version ?? '—');
}

export async function saveCompany(input: Partial<Company> & { stampFile?: File; signatureFile?: File }): Promise<Company> {
  const { stampFile, signatureFile, ...rest } = input;
  if (!stampFile && !signatureFile) return putOne<Company>('/company/', rest);
  const form = new FormData();
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined && v !== null) form.append(k, String(v));
  }
  if (stampFile) form.append('stamp', stampFile);
  if (signatureFile) form.append('signature', signatureFile);
  const r = await fetch('/api/v1/company/', {
    method: 'PUT', body: form, headers: authHeaders(),
  });
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) throw new Error('Enregistrement impossible.');
  return r.json();
}

/* Fichiers médias Django (/media/) : même origine en dev (proxy Vite)
   comme en prod (Nginx) — ni contenu mixte en HTTPS, ni 127.0.0.1 sur téléphone. */
export function mediaUrl(path: string | null): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return path;
}

export function authHeaders(): Record<string, string> {
  const a = localStorage.getItem('bko.access');
  return a ? { Authorization: `Bearer ${a}` } : {};
}

export async function createNotice(input: { type: 'communique' | 'lettre'; title: string; content: string }): Promise<Notice> {
  return postOne<Notice>('/notices/', input);
}

export async function publishNotice(id: number): Promise<Notice> {
  return postOne<Notice>(`/notices/${id}/publish/`, {});
}

/* Paie façon Hub Digi : UNE fiche mensuelle d'équipe, lignes = employés
   (numéro auto, poste/site figés, statut En attente/Payé), cachet exigé. */
export interface Employee {
  id: number; name: string; role: string; site: number | null; site_name: string;
  user: number | null; user_name: string; has_account: boolean; active: boolean;
}
export interface PayslipLine { id: number; payslip: number; kind: 'gain' | 'deduction'; label: string; amount: number }
export interface PayslipPayment { id: number; payslip: number; amount: number; entry_ref: string; paid_at: string }
export interface Payslip {
  id: number; sheet: number; number: string; user: number | null; employee: number; employee_name: string;
  position: string; site_name: string; month: string;
  base_amount: number; gross: number; deductions: number; net: number; paid: number;
  status: 'en_attente' | 'paye'; paid_at: string | null;
  lines: PayslipLine[]; payments: PayslipPayment[];
}
export interface PayrollSheet {
  id: number; month: string; status: 'draft' | 'closed'; stamp: string | null;
  total: number; slips: Payslip[];
}

export type HRStatus = 'draft' | 'pending_signature' | 'signed' | 'cancelled';
export interface HRDocumentBase {
  id: number; employee: number; employee_name: string; employee_role: string;
  employee_site_name: string; employee_user: number | null;
  reference: string; status: HRStatus; status_label: string;
  created_by: number | null; created_by_name: string;
  sent_at: string | null; signed_at: string | null; signed_hash: string;
  has_pdf: boolean; company_signed_at: string | null; company_signer_name: string;
  employee_signed_at: string | null; employee_signer_name: string;
  created_at: string; updated_at: string;
}
export interface Contract extends HRDocumentBase {
  contract_type: 'cdi' | 'cdd' | 'stage' | 'apprentissage' | 'autre';
  contract_type_label: string;
  start: string; end: string | null; base_salary: number; frequency: string;
  job_title: string; workplace: string; weekly_hours: number; trial_months: number;
  content: string;
}
export interface ContractInput {
  employee: number; start: string; base_salary: number; contract_type?: string;
  end?: string | null; job_title?: string; workplace?: string;
  weekly_hours?: number; trial_months?: number; content?: string; frequency?: string;
}
export interface HRLetter extends HRDocumentBase {
  contract: number | null; contract_reference: string;
  kind: 'promotion' | 'augmentation' | 'prime' | 'attestation' | 'autre';
  kind_label: string; title: string; date: string; content: string;
  amount: number | null; new_salary: number | null; new_job_title: string;
  effective_date: string | null;
}
export interface HRLetterInput {
  employee: number; contract?: number | null;
  kind: 'promotion' | 'augmentation' | 'prime' | 'attestation' | 'autre';
  title?: string; date?: string; content?: string;
  amount?: number | null; new_salary?: number | null;
  new_job_title?: string; effective_date?: string | null;
}
export interface HRToSign {
  type: 'contract' | 'letter'; id: number; reference: string;
  title: string; employee_name: string; url: string;
}
export interface HRSigned extends HRToSign { signed_at: string }
export interface HRActivity { to_sign: HRToSign[]; signed: HRSigned[] }
export interface MyHRDocuments {
  employee: Employee | null; contracts: Contract[]; letters: HRLetter[];
}

export const listEmployees = (): Promise<Employee[]> => list<Employee>('/employees/');
export const listContracts = (): Promise<Contract[]> => list<Contract>('/contracts/');
export const listHRLetters = (): Promise<HRLetter[]> => list<HRLetter>('/hr-letters/');
export const listSheets = (): Promise<PayrollSheet[]> => list<PayrollSheet>('/sheets/');

export async function createEmployee(input: {
  name: string; role?: string; site?: number | null; user?: number | null; active?: boolean;
}): Promise<Employee> {
  return postOne<Employee>('/employees/', input);
}

export async function updateEmployee(id: number, input: {
  name?: string; role?: string; site?: number | null; user?: number | null; active?: boolean;
}): Promise<Employee> {
  return patchOne<Employee>(`/employees/${id}/`, input);
}

export async function createContract(input: ContractInput): Promise<Contract> {
  return postOne<Contract>('/contracts/', input);
}

export async function updateContract(id: number, input: Partial<ContractInput>): Promise<Contract> {
  return patchOne<Contract>(`/contracts/${id}/`, input);
}

export async function createHRLetter(input: HRLetterInput): Promise<HRLetter> {
  return postOne<HRLetter>('/hr-letters/', input);
}

export async function updateHRLetter(id: number, input: Partial<HRLetterInput>): Promise<HRLetter> {
  return patchOne<HRLetter>(`/hr-letters/${id}/`, input);
}

export async function deleteHRDocument(kind: 'contracts' | 'hr-letters', id: number): Promise<void> {
  const r = await req(`/${kind}/${id}/`, { method: 'DELETE' });
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Suppression impossible.');
  }
}

export async function sendHRDocument(kind: 'contracts' | 'hr-letters', id: number): Promise<Contract | HRLetter> {
  return postOne<Contract | HRLetter>(`/${kind}/${id}/send/`, {});
}

export async function signHRDocument(kind: 'contracts' | 'hr-letters', id: number, input: {
  full_name: string; signature: string; consent: boolean;
}): Promise<Contract | HRLetter> {
  return postOne<Contract | HRLetter>(`/${kind}/${id}/sign/`, input);
}

export async function myHRDocuments(): Promise<MyHRDocuments> {
  const r = await req('/hr/my-documents/');
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) throw new Error('Documents RH indisponibles.');
  return r.json();
}

export async function hrActivity(): Promise<HRActivity> {
  const r = await req('/hr/activity/');
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) throw new Error('Activité RH indisponible.');
  return r.json();
}

export async function createSheet(year: number, month: number): Promise<PayrollSheet> {
  return postOne<PayrollSheet>('/sheets/create_sheet/', { year, month });
}

export async function getSheet(id: number): Promise<PayrollSheet> {
  const r = await req(`/sheets/${id}/`);
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) throw new Error('Fiche introuvable.');
  return r.json();
}

export async function deleteSheet(id: number): Promise<void> {
  const r = await req(`/sheets/${id}/`, { method: 'DELETE' });
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Suppression impossible (fiche clôturée ou versements existants).');
  }
}

export async function fillTeam(id: number): Promise<PayrollSheet & { created: number }> {
  return postOne<PayrollSheet & { created: number }>(`/sheets/${id}/fill_team/`, {});
}

export async function closeSheet(id: number): Promise<PayrollSheet> {
  return postOne<PayrollSheet>(`/sheets/${id}/close/`, {});
}

export async function uploadStamp(id: number, file: File): Promise<PayrollSheet> {
  const form = new FormData();
  form.append('stamp', file);
  const r = await fetch(`/api/v1/sheets/${id}/stamp/`, {
    method: 'POST', body: form, headers: authHeaders(),
  });
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Import impossible.');
  }
  return r.json();
}

export async function removeStamp(id: number): Promise<PayrollSheet> {
  const r = await req(`/sheets/${id}/stamp/`, { method: 'DELETE' });
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) throw new Error('Retrait impossible.');
  return r.json();
}

export async function generatePayslip(input: { sheet: number; user: number }): Promise<Payslip> {
  return postOne<Payslip>('/payslips/generate/', input);
}

/* Base saisie librement (brouillon seul). N°, statut et date : automatiques. */
export async function setSlipBase(id: number, amount: number): Promise<Payslip> {
  return postOne<Payslip>(`/payslips/${id}/set_base/`, { amount });
}

export async function addPayslipLine(id: number, input: { kind: 'gain' | 'deduction'; label: string; amount: number }): Promise<PayslipLine> {
  return postOne<PayslipLine>(`/payslips/${id}/add_line/`, input);
}

export async function payPayslip(id: number, amount: number): Promise<Payslip> {
  return postOne<Payslip>(`/payslips/${id}/pay/`, { amount });
}
export function saveDraft(d: string): void { try { localStorage.setItem(draftKey(), d); } catch { /* stockage indisponible */ } }
export function loadDraft(): string | null { try { return localStorage.getItem(draftKey()); } catch { return null; } }
export function clearDraft(): void { try { localStorage.removeItem(draftKey()); } catch { /* stockage indisponible */ } }
