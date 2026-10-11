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
export async function login(username, password) {
    const r = await req('/auth/token/', { method: 'POST', body: JSON.stringify({ username, password }) }, false);
    if (!r.ok)
        throw new Error('Identifiants invalides.');
    const t = (await r.json());
    store.access = t.access;
    store.refresh = t.refresh;
}
export function logout() { store.access = null; store.refresh = null; }
export async function listBookings() {
    const r = await req('/bookings/');
    if (!r.ok)
        throw new Error('Chargement impossible, réessayez.');
    const data = await r.json();
    return Array.isArray(data) ? data : data.results ?? [];
}
export async function createBooking(input) {
    const r = await req('/bookings/', { method: 'POST', body: JSON.stringify(input) });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail ?? 'Enregistrement impossible, réessayez.');
    }
    return r.json();
}
