// v1.5-consistencia-C · Outbox offline del cobro (cero ventas perdidas).
//
// Garantía: una vez el cajero pulsa Cobrar, la venta ya no se puede
// perder. El payload completo del POST (con su externalId de
// idempotencia ya generado) se persiste en IndexedDB ANTES de lanzar el
// request; la pantalla de éxito depende sólo de esa persistencia local.
// El reenvío ocurre al arrancar la PWA, al evento `online` y cada
// OUTBOX_FLUSH_INTERVAL_MS, apoyándose en la idempotencia por
// externalId del backend (mismo externalId → 200 duplicate, nunca un
// ticket doble — cubierto en apps/api/test/tickets-route.test.ts).
//
// Estados de un item:
//   pending  → escrito antes del POST; se reintenta hasta 2xx.
//   (borrado)→ el 2xx confirmó; el item desaparece del store.
//   rejected → el servidor lo rechazó con un error permanente (4xx de
//              validación, no de red). NO se reintenta en bucle: queda
//              visible en el chip de pendientes para acción manual y se
//              reporta a Sentry.
//
// Multi-pestaña: lock optimista por item con marca de tiempo. Antes de
// enviar, una transacción readwrite re-lee el item y sólo lo toma si no
// hay lock fresco (< OUTBOX_LOCK_TTL_MS). Un lock de una pestaña muerta
// caduca solo; la idempotencia del backend es la red de seguridad si
// dos pestañas llegasen a solapar un envío.
//
// La BD es `mipiacetpv-outbox`, deliberadamente FUERA de
// IDB_NAMES_TO_CLEAR de version-check.ts: las ventas pendientes deben
// sobrevivir a deploys y limpiezas de cache.

import { ApiError, apiWithCashier } from "../api.js";
import { newId } from "./ids.js";
import { captureError } from "./sentry.js";

const DB_NAME = "mipiacetpv-outbox";
const DB_VERSION = 1;
const STORE = "outbox";

export const OUTBOX_LOCK_TTL_MS = 30_000;
export const OUTBOX_FLUSH_INTERVAL_MS = 15_000;

export type OutboxKind = "ticket" | "refund";
export type OutboxStatus = "pending" | "rejected";

export interface OutboxItem {
  externalId: string;
  kind: OutboxKind;
  // "/tickets", "/refunds" o "/tickets/:id/checkout" (v1.0-mesas-frontend:
  // el cobro de mesa también pasa por el outbox).
  path: string;
  body: Record<string, unknown>;
  // Para pintar el item en el chip de pendientes sin parsear el body.
  label: string;
  total: number;
  // v1.0-mesas-frontend: presente cuando el item es el checkout de una
  // mesa. Mientras el item exista (pending o rejected), ESTE dispositivo
  // bloquea reabrir/editar esa mesa — está "cobrada en tránsito".
  tableId?: string;
  status: OutboxStatus;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  lockedAt: number | null;
  lockOwner: string | null;
}

export type OutboxEvent =
  | { type: "change" }
  | { type: "sent"; externalId: string; response: unknown }
  | { type: "rejected"; externalId: string; reason: string };

// Identidad de esta pestaña para el lock optimista.
const TAB_ID = newId();

let dbPromise: Promise<IDBDatabase> | null = null;
let flushing = false;
const listeners = new Set<(e: OutboxEvent) => void>();

export function subscribeOutbox(fn: (e: OutboxEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(e: OutboxEvent): void {
  for (const fn of [...listeners]) {
    try {
      fn(e);
    } catch {
      /* un listener roto no debe tumbar el flush */
    }
  }
}

// ─── Plumbing IndexedDB ──────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "externalId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(req.error ?? new Error("IndexedDB open falló"));
    });
  }
  return dbPromise;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request falló"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(STORE, mode);
  const result = await fn(tx.objectStore(STORE));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx falló"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB tx abortada"));
  });
  return result;
}

async function rawGetAll(): Promise<OutboxItem[]> {
  return withStore("readonly", (store) =>
    reqToPromise(store.getAll() as IDBRequest<OutboxItem[]>),
  );
}

async function rawDelete(externalId: string): Promise<void> {
  await withStore("readwrite", (store) =>
    reqToPromise(store.delete(externalId)),
  );
}

async function rawPatch(
  externalId: string,
  patch: Partial<OutboxItem>,
): Promise<void> {
  await withStore("readwrite", async (store) => {
    const current = (await reqToPromise(
      store.get(externalId) as IDBRequest<OutboxItem | undefined>,
    )) ?? null;
    if (!current) return;
    await reqToPromise(store.put({ ...current, ...patch }));
  });
}

// ─── API pública ─────────────────────────────────────────────────────

/** Persiste el payload ANTES de lanzar el POST. `lock: true` marca el
 *  item como "en vuelo" en esta pestaña para que el flush periódico no
 *  lo reenvíe en paralelo al request interactivo; si el request falla,
 *  hay que soltarlo con `outboxReleaseAfterFailure`. */
export async function outboxAdd(
  input: {
    externalId: string;
    kind: OutboxKind;
    path: string;
    body: Record<string, unknown>;
    label: string;
    total: number;
    tableId?: string;
  },
  opts: { lock?: boolean } = {},
): Promise<void> {
  const now = Date.now();
  const item: OutboxItem = {
    ...input,
    status: "pending",
    createdAt: now,
    attempts: 0,
    lastError: null,
    lockedAt: opts.lock ? now : null,
    lockOwner: opts.lock ? TAB_ID : null,
  };
  await withStore("readwrite", (store) => reqToPromise(store.put(item)));
  emit({ type: "change" });
}

/** Borra el item (2xx confirmado por el camino interactivo, o descarte
 *  manual de un rechazado). */
export async function outboxDelete(externalId: string): Promise<void> {
  await rawDelete(externalId);
  emit({ type: "change" });
}

/** El POST interactivo falló por red/5xx: suelta el lock para que el
 *  flush en background reintente, y registra el motivo. */
export async function outboxReleaseAfterFailure(
  externalId: string,
  message: string,
): Promise<void> {
  await withStore("readwrite", async (store) => {
    const current = (await reqToPromise(
      store.get(externalId) as IDBRequest<OutboxItem | undefined>,
    )) ?? null;
    if (!current) return;
    await reqToPromise(
      store.put({
        ...current,
        attempts: current.attempts + 1,
        lastError: message,
        lockedAt: null,
        lockOwner: null,
      }),
    );
  });
  emit({ type: "change" });
}

export async function outboxList(): Promise<OutboxItem[]> {
  const items = await rawGetAll();
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

/** Mesas con un checkout en tránsito EN ESTE DISPOSITIVO (pending o
 *  rejected). El mapa local las bloquea hasta que el item se resuelva
 *  (2xx → borrado) o se descarte a mano desde el chip. */
export async function outboxBlockedTableIds(): Promise<Set<string>> {
  const items = await rawGetAll();
  const ids = new Set<string>();
  for (const i of items) {
    if (i.tableId) ids.add(i.tableId);
  }
  return ids;
}

export async function outboxCounts(): Promise<{
  pending: number;
  rejected: number;
}> {
  const items = await rawGetAll();
  let pending = 0;
  let rejected = 0;
  for (const i of items) {
    if (i.status === "rejected") rejected += 1;
    else pending += 1;
  }
  return { pending, rejected };
}

/** Acción manual sobre un rechazado: vuelve a pending y dispara un
 *  flush inmediato. */
export async function outboxRetry(externalId: string): Promise<void> {
  await rawPatch(externalId, {
    status: "pending",
    lockedAt: null,
    lockOwner: null,
  });
  emit({ type: "change" });
  void flushOutbox();
}

/** Errores permanentes del servidor (validación) — no tiene sentido
 *  reintentarlos en bucle. 401 (sin sesión de cajero), 408 y 429 son
 *  transitorios; red y 5xx también. */
export function isPermanentRejection(err: ApiError): boolean {
  if (err.status === 401 || err.status === 408 || err.status === 429) {
    return false;
  }
  return err.status >= 400 && err.status < 500;
}

function rejectionReason(err: ApiError): string {
  return err.code ? `${err.code}: ${err.message}` : err.message;
}

// ─── Reenvío ─────────────────────────────────────────────────────────

/** Toma el lock del item dentro de una transacción readwrite (re-lee y
 *  escribe atómicamente). Devuelve el item lockeado o null si otro
 *  envío lo tiene fresco o ya no está pending. */
async function acquireLock(externalId: string): Promise<OutboxItem | null> {
  const now = Date.now();
  return withStore("readwrite", async (store) => {
    const current = (await reqToPromise(
      store.get(externalId) as IDBRequest<OutboxItem | undefined>,
    )) ?? null;
    if (!current || current.status !== "pending") return null;
    if (current.lockedAt !== null && now - current.lockedAt < OUTBOX_LOCK_TTL_MS) {
      return null;
    }
    const locked: OutboxItem = { ...current, lockedAt: now, lockOwner: TAB_ID };
    await reqToPromise(store.put(locked));
    return locked;
  });
}

async function sendItem(item: OutboxItem): Promise<void> {
  try {
    const response = await apiWithCashier<unknown>(item.path, {
      method: "POST",
      body: item.body,
    });
    // 201 creado o 200 duplicate:true — en ambos casos el servidor
    // tiene la venta; el item ya cumplió su función.
    await rawDelete(item.externalId);
    emit({ type: "sent", externalId: item.externalId, response });
    emit({ type: "change" });
  } catch (err) {
    if (err instanceof ApiError && isPermanentRejection(err)) {
      const reason = rejectionReason(err);
      await rawPatch(item.externalId, {
        status: "rejected",
        attempts: item.attempts + 1,
        lastError: reason,
        lockedAt: null,
        lockOwner: null,
      });
      captureError(err, {
        outboxKind: item.kind,
        externalId: item.externalId,
        attempts: item.attempts + 1,
      });
      emit({ type: "rejected", externalId: item.externalId, reason });
      emit({ type: "change" });
    } else {
      // Red caída, 5xx, sin sesión — transitorio: soltamos el lock y
      // el siguiente ciclo reintenta.
      const message =
        err instanceof Error ? err.message : "Error de red desconocido";
      await rawPatch(item.externalId, {
        attempts: item.attempts + 1,
        lastError: message,
        lockedAt: null,
        lockOwner: null,
      });
      emit({ type: "change" });
    }
  }
}

/** Reenvía todo lo pending cuyo lock no esté fresco. Reentrante-safe
 *  dentro de la pestaña (no-op si ya hay un flush en curso). */
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const pending = (await rawGetAll()).filter((i) => i.status === "pending");
    for (const item of pending) {
      const locked = await acquireLock(item.externalId);
      if (!locked) continue;
      await sendItem(locked);
    }
  } catch (err) {
    // IndexedDB inaccesible (modo privado restrictivo) — no hay outbox
    // que reenviar; el cobro interactivo ya degradó a POST directo.
    captureError(err, { outbox: "flush" });
  } finally {
    flushing = false;
  }
}

/** Registra los disparadores de reenvío: arranque, evento `online` y
 *  tick periódico. Devuelve la función de limpieza. */
export function startOutboxSync(
  opts: { intervalMs?: number } = {},
): () => void {
  const intervalMs = opts.intervalMs ?? OUTBOX_FLUSH_INTERVAL_MS;
  void flushOutbox();
  const onOnline = () => {
    void flushOutbox();
  };
  window.addEventListener("online", onOnline);
  const timer = window.setInterval(() => {
    void flushOutbox();
  }, intervalMs);
  return () => {
    window.removeEventListener("online", onOnline);
    window.clearInterval(timer);
  };
}

// ─── Sólo tests ──────────────────────────────────────────────────────

/** Cierra la conexión cacheada y resetea el estado del módulo para que
 *  cada test arranque con un IDBFactory limpio. */
export async function __resetOutboxForTests(): Promise<void> {
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      /* ya cerrada */
    }
  }
  dbPromise = null;
  flushing = false;
  listeners.clear();
}
