// F1 · la cola local de la pantalla de fichar (ADR-018).
//
// Copia reducida de `apps/tpv-web/src/lib/outbox.ts`, con su garantía
// intacta: **una vez el empleado toca el botón, el fichaje ya no se puede
// perder.** El payload se persiste en IndexedDB ANTES de lanzar el POST y
// la pantalla depende de esa persistencia, no de la red. Colegio con
// sótano, obra sin señal: el toque nunca falla por red.
//
// Se quedan fuera las piezas del TPV que aquí no existen: turnos locales,
// mesas bloqueadas, PATCH, rechazos con acción manual.
//
// Y entra UNA pieza nueva: `holdUntil`.
//
//   El "deshacer durante 4 s" del toque sin querer no puede ser un DELETE
//   en el servidor — los registros de jornada no se borran (es media
//   razón de ser del bloque). Así que el toque se persiste YA, con
//   `holdUntil = ahora + 4 s`, y el flush salta los items cuyo plazo no
//   ha vencido. Deshacer borra el item local antes de que salga.
//
//   Con eso se cumplen las dos cosas a la vez: si el empleado mata la app
//   dentro de esos cuatro segundos el fichaje SOBREVIVE y se envía al
//   arrancar, y si pulsa "Deshacer" nunca existió en el servidor. Pasados
//   los 4 s el banner desaparece y cualquier cambio ya es una corrección.

import { ficharApi, isPermanent } from "./api.js";

const DB_NAME = "mipiacetpv-fichaje-outbox";
const DB_VERSION = 1;
const STORE = "outbox";

export const UNDO_WINDOW_MS = 4_000;
export const FLUSH_INTERVAL_MS = 15_000;
export const LOCK_TTL_MS = 30_000;

export type FicharKind = "in" | "out";

export interface FicharOutboxItem {
  externalId: string;
  kind: FicharKind;
  path: string;
  body: Record<string, unknown>;
  /** Hora del toque, la que cuenta. Se pinta en el "pendiente de enviar". */
  tappedAt: number;
  /** No sale hasta aquí: la ventana de deshacer. */
  holdUntil: number;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  lockedAt: number | null;
}

export type OutboxEvent =
  | { type: "change" }
  | { type: "sent"; externalId: string; response: unknown }
  | { type: "failed"; externalId: string; reason: string };

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
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open falló"));
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

export async function outboxList(): Promise<FicharOutboxItem[]> {
  const items = await withStore("readonly", (s) =>
    reqToPromise(s.getAll() as IDBRequest<FicharOutboxItem[]>),
  );
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

/** Persiste el toque ANTES de lanzar nada. Devuelve el item para que la
 *  pantalla pueda pintarlo como hecho inmediatamente. */
export async function outboxAdd(input: {
  externalId: string;
  kind: FicharKind;
  path: string;
  body: Record<string, unknown>;
  tappedAt: number;
  undoMs?: number;
}): Promise<FicharOutboxItem> {
  const now = Date.now();
  const item: FicharOutboxItem = {
    externalId: input.externalId,
    kind: input.kind,
    path: input.path,
    body: input.body,
    tappedAt: input.tappedAt,
    holdUntil: now + (input.undoMs ?? UNDO_WINDOW_MS),
    createdAt: now,
    attempts: 0,
    lastError: null,
    lockedAt: null,
  };
  await withStore("readwrite", (s) => reqToPromise(s.put(item)));
  emit({ type: "change" });
  return item;
}

/** Deshacer. Sólo vale mientras el item no haya salido: pasado el plazo,
 *  el fichaje ya está en el servidor y lo que toca es corregirlo. */
export async function outboxUndo(externalId: string): Promise<boolean> {
  const done = await withStore("readwrite", async (s) => {
    const current =
      (await reqToPromise(s.get(externalId) as IDBRequest<FicharOutboxItem | undefined>)) ??
      null;
    if (!current) return false;
    if (current.holdUntil <= Date.now()) return false;
    await reqToPromise(s.delete(externalId));
    return true;
  });
  if (done) emit({ type: "change" });
  return done;
}

export async function outboxDelete(externalId: string): Promise<void> {
  await withStore("readwrite", (s) => reqToPromise(s.delete(externalId)));
  emit({ type: "change" });
}

async function patch(
  externalId: string,
  data: Partial<FicharOutboxItem>,
): Promise<void> {
  await withStore("readwrite", async (s) => {
    const current =
      (await reqToPromise(s.get(externalId) as IDBRequest<FicharOutboxItem | undefined>)) ??
      null;
    if (!current) return;
    await reqToPromise(s.put({ ...current, ...data }));
  });
}

/** ¿Puede salir ya este item? Es la única puerta del flush, y está aquí
 *  suelta para poder probarla sin IndexedDB. */
export function isReleasable(item: FicharOutboxItem, now: number): boolean {
  if (item.holdUntil > now) return false;
  if (item.lockedAt !== null && now - item.lockedAt < LOCK_TTL_MS) return false;
  return true;
}

export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const now = Date.now();
    const items = (await outboxList()).filter((i) => isReleasable(i, now));
    for (const item of items) {
      await patch(item.externalId, { lockedAt: Date.now() });
      try {
        const response = await ficharApi<unknown>(item.path, {
          method: "POST",
          body: item.body,
        });
        await withStore("readwrite", (s) => reqToPromise(s.delete(item.externalId)));
        emit({ type: "sent", externalId: item.externalId, response });
        emit({ type: "change" });
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Error de red";
        if (isPermanent(err)) {
          // El servidor ha dicho que no y no va a cambiar de opinión
          // (p. ej. un tramo abierto de otro día que hay que contestar).
          // Se saca de la cola y se avisa: dejarlo reintentando en bucle
          // sería enseñar "pendiente de enviar" para siempre.
          await withStore("readwrite", (s) =>
            reqToPromise(s.delete(item.externalId)),
          );
          emit({ type: "failed", externalId: item.externalId, reason });
          emit({ type: "change" });
        } else {
          await patch(item.externalId, {
            attempts: item.attempts + 1,
            lastError: reason,
            lockedAt: null,
          });
          emit({ type: "change" });
        }
      }
    }
  } catch {
    // IndexedDB inaccesible. No hay cola que vaciar; el camino
    // interactivo ya habrá hecho lo que podía.
  } finally {
    flushing = false;
  }
}

/** Arranque, evento `online`, y un tick corto: el tick tiene que ser más
 *  fino que la ventana de deshacer, o un toque se quedaría esperando 15 s
 *  con la red puesta. */
export function startOutboxSync(opts: { intervalMs?: number } = {}): () => void {
  const intervalMs = opts.intervalMs ?? 2_000;
  void flushOutbox();
  const onOnline = () => void flushOutbox();
  window.addEventListener("online", onOnline);
  const timer = window.setInterval(() => void flushOutbox(), intervalMs);
  return () => {
    window.removeEventListener("online", onOnline);
    window.clearInterval(timer);
  };
}

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
