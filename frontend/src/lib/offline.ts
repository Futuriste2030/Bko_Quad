/* J : mode hors ligne — file d'attente locale (IndexedDB) + cache de lecture.
 *
 * Règles : rien n'est perdu, rien n'est inventé.
 * - Une saisie faite sans réseau part en file avec une clé d'idempotence
 *   (uuid de l'appareil) : le Hub ne l'exécute qu'une fois au rejeu.
 * - Une saisie en file n'est jamais « confirmée » avant le rejeu : l'écran
 *   affiche « À synchroniser » (guide §5).
 * - La file est rattachée au compte qui l'a créée : un autre compte sur le
 *   même téléphone ne la rejoue pas. */

export type OpKind = 'customer' | 'booking' | 'cash' | 'invoice' | 'expense' | 'anomaly' | 'message';

export interface QueuedOp {
  id: string;                // clé d'idempotence (uuid de l'appareil)
  method: 'POST';
  path: string;              // '/api/v1/...'
  body: unknown;             // corps envoyé au rejeu (refs par placeholder)
  kind: OpKind;
  label: string;             // libellé lisible (liste de synchronisation)
  meta: Record<string, string | number>;
  createdAt: string;         // heure de saisie sur l'appareil
  status: 'pending' | 'failed';
  error?: string;
  localId?: number;          // identifiant local renvoyé aux écrans (négatif)
  owner?: number | null;     // compte ayant fait la saisie
}

const DB_NAME = 'bko-offline';
const DB_VERSION = 1;
const QUEUE = 'queue';
const CACHE = 'cache';
export const QUEUE_EVENT = 'bko:queue';

let dbPromise: Promise<IDBDatabase> | null = null;
let hydrated: Promise<void> | null = null;
let localSeq = 0;
const localToOp = new Map<number, string>();

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB indisponible.')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponible.'));
  });
  return dbPromise;
}

async function store<T>(name: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const req = run(tx.objectStore(name));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Stockage local indisponible.'));
  });
}

export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function notifyQueue(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEUE_EVENT));
}

export function onQueueChange(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(QUEUE_EVENT, fn);
  return () => window.removeEventListener(QUEUE_EVENT, fn);
}

/* --- File d'attente ---------------------------------------------------- */

export async function allOps(): Promise<QueuedOp[]> {
  const ops = await store<QueuedOp[]>(QUEUE, 'readonly', (s) => s.getAll() as IDBRequest<QueuedOp[]>);
  return (ops ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function putOp(op: QueuedOp): Promise<void> {
  await store(QUEUE, 'readwrite', (s) => s.put(op));
  notifyQueue();
}

export async function removeOp(id: string): Promise<void> {
  await store(QUEUE, 'readwrite', (s) => s.delete(id));
  notifyQueue();
}

export async function markOpFailed(id: string, error: string): Promise<void> {
  const op = (await allOps()).find((o) => o.id === id);
  if (!op) return;
  await putOp({ ...op, status: 'failed', error });
}

export async function resetOp(id: string): Promise<void> {
  const op = (await allOps()).find((o) => o.id === id);
  if (!op) return;
  await putOp({ ...op, status: 'pending', error: undefined });
}

export async function pendingCount(): Promise<number> {
  const ops = await allOps();
  return ops.filter((o) => o.status === 'pending').length;
}

/* --- Identifiants locaux (saisies pas encore synchronisées) ----------- */

export async function allocLocalId(): Promise<number> {
  await hydrate();
  localSeq -= 1;
  return localSeq;
}

export function isLocalId(id: number | undefined | null): boolean {
  return typeof id === 'number' && id < 0;
}

async function hydrate(): Promise<void> {
  if (!hydrated) {
    hydrated = (async () => {
      try {
        const ops = await allOps();
        for (const op of ops) {
          if (typeof op.localId === 'number' && op.localId < 0) {
            localToOp.set(op.localId, op.id);
            if (op.localId <= localSeq) localSeq = op.localId - 1;
          }
        }
      } catch { /* IndexedDB indisponible : la file ne fonctionnera pas */ }
    })();
  }
  return hydrated;
}

/* Remplace les identifiants locaux par des placeholders {__ref: opId}.
   `{ __self: true }` devient la clé d'idempotence de l'opération courante. */
function withRefs(value: unknown, selfId: string): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (Object.keys(o).length === 1 && o.__self === true) return { __ref: selfId };
  }
  if (typeof value === 'number' && value < 0) {
    const opId = localToOp.get(value);
    if (!opId) throw new Error('Saisie hors ligne liée introuvable.');
    return { __ref: opId };
  }
  if (Array.isArray(value)) return value.map((v) => withRefs(v, selfId));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = withRefs(v, selfId);
    return out;
  }
  return value;
}

/* Résout les placeholders avec les identifiants créés au rejeu. */
export function resolveRefs(value: unknown, created: Map<string, any>): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (Object.keys(o).length === 1 && typeof o.__ref === 'string') {
      const made = created.get(o.__ref);
      if (!made) throw new Error('Saisie liée non synchronisée.');
      return (made && typeof made === 'object' && 'id' in made) ? made.id : made;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = resolveRefs(v, created);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, created));
  return value;
}

export interface EnqueueInput {
  id?: string;            // clé d'idempotence (reuse de l'appel en ligne)
  method: 'POST';
  path: string;
  body: unknown;
  kind: OpKind;
  label: string;
  meta?: Record<string, string | number>;
  localId?: number;
  owner?: number | null;
}

export async function enqueueOp(input: EnqueueInput): Promise<QueuedOp> {
  await hydrate();
  const id = input.id ?? uuid();
  const op: QueuedOp = {
    id,
    method: input.method,
    path: input.path,
    body: withRefs(input.body, id),
    kind: input.kind,
    label: input.label,
    meta: input.meta ?? {},
    createdAt: new Date().toISOString(),
    status: 'pending',
    localId: input.localId,
    owner: input.owner ?? null,
  };
  if (typeof op.localId === 'number') localToOp.set(op.localId, id);
  await putOp(op);
  return op;
}

/* --- Cache de lecture (listes consultées hors ligne) ------------------ */

export async function cacheSet(key: string, value: unknown): Promise<void> {
  try {
    await store(CACHE, 'readwrite', (s) => s.put({ key, value, at: new Date().toISOString() }));
  } catch { /* quota plein : la lecture hors ligne sera partielle */ }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const row = await store<{ key: string; value: T } | undefined>(
      CACHE, 'readonly', (s) => s.get(key) as IDBRequest<{ key: string; value: T } | undefined>);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function cacheClear(): Promise<void> {
  try {
    await store(CACHE, 'readwrite', (s) => s.clear());
  } catch { /* rien à vider */ }
}
