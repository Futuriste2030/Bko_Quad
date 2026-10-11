/* Client typé de l'API v1. Base commune pour PWA agence puis app client. */
const BASE = '/api/v1';
const store = {
    get access() { return localStorage.getItem('bko.access'); },
    set access(v) { v ? localStorage.setItem('bko.access', v) : localStorage.removeItem('bko.access'); },
    get refresh() { return localStorage.getItem('bko.refresh'); },
    set refresh(v) { v ? localStorage.setItem('bko.refresh', v) : localStorage.removeItem('bko.refresh'); },
};
async function req(path, init = {}, auth = true) {
    const headers = { 'Content-Type': 'application/json', ...init.headers };
    if (auth && store.access)
        headers.Authorization = `Bearer ${store.access}`;
    return fetch(`${BASE}${path}`, { ...init, headers });
}
async function list(path) {
    const r = await req(path);
    if (r.status === 401) {
        logout();
        throw new Error('Session expirée, reconnectez-vous.');
    }
    if (!r.ok)
        throw new Error('Chargement impossible, réessayez.');
    const data = await r.json();
    return Array.isArray(data) ? data : data.results ?? [];
}
export async function login(username, password) {
    const r = await req('/auth/token/', { method: 'POST', body: JSON.stringify({ username, password }) }, false);
    if (!r.ok)
        throw new Error('Identifiants invalides.');
    const t = (await r.json());
    store.access = t.access;
    store.refresh = t.refresh;
}
export function logout() { store.access = null; store.refresh = null; }
export const listBookings = () => list('/bookings/');
export const listSlots = () => list('/slots/');
export const listCustomers = () => list('/customers/');
export const listCalls = () => list('/calls/');
export const listAnomalies = () => list('/anomalies/');
export async function createBooking(input) {
    const r = await req('/bookings/', { method: 'POST', body: JSON.stringify(input) });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail ?? 'Enregistrement impossible, réessayez.');
    }
    return r.json();
}
export async function createCustomer(input) {
    const r = await req('/customers/', { method: 'POST', body: JSON.stringify(input) });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        const first = err.phone?.[0] ?? err.name?.[0] ?? err.detail;
        throw new Error(first ?? 'Client impossible à créer.');
    }
    return r.json();
}
export async function reconcileCall(id) {
    const r = await req(`/calls/${id}/reconcile/`, { method: 'POST', body: '{}' });
    if (!r.ok)
        throw new Error('Rapprochement impossible.');
    return r.json();
}
export async function resolveAnomaly(id, reason, comment = '') {
    const r = await req(`/anomalies/${id}/resolve/`, { method: 'POST', body: JSON.stringify({ reason, comment }) });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail ?? 'Motif obligatoire pour clore.');
    }
    return r.json();
}
export async function validateClosing(date) {
    const r = await req('/closings/validate/', { method: 'POST', body: JSON.stringify({ date }) });
    if (!r.ok)
        throw new Error('Clôture impossible.');
    return r.json();
}
export async function createPayLink(booking) {
    const r = await req('/payments/link/', { method: 'POST', body: JSON.stringify({ booking }) });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail ?? 'Lien de paiement impossible.');
    }
    return r.json();
}
export async function logMessage(booking, text) {
    const r = await req('/messages/', { method: 'POST', body: JSON.stringify({ booking, text }) });
    if (!r.ok)
        throw new Error('Journalisation impossible.');
    return r.json();
}
export async function cancelBooking(id, reason) {
    const r = await req(`/bookings/${id}/cancel/`, { method: 'POST', body: JSON.stringify({ reason }) });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail ?? 'Annulation impossible.');
    }
    return r.json();
}
export function todayISO() { return new Date().toISOString().slice(0, 10); }
export function draftKey() { return 'bko.draft'; }
export function saveDraft(d) { try {
    localStorage.setItem(draftKey(), d);
}
catch { /* stockage indisponible */ } }
export function loadDraft() { try {
    return localStorage.getItem(draftKey());
}
catch {
    return null;
} }
export function clearDraft() { try {
    localStorage.removeItem(draftKey());
}
catch { /* stockage indisponible */ } }
