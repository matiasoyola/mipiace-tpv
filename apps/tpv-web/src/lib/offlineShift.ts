// v1.10-offline-un-terminal §3 · Estado de turno local.
//
// Guarda el turno en curso en la BD `mipiacetpv-auth` (store `shift`),
// para que el terminal pueda abrir/operar/cerrar un turno sin red. Un
// turno abierto offline nace con un `localId` (UUID) y `serverId: null`;
// cuando el POST /shift/open del outbox sincroniza, `resolveLocalShift`
// fija el `serverId` real que devuelve el server. El outbox reescribe
// entonces el shiftId de los tickets/arqueos pendientes (local → server)
// — ver lib/outbox.ts.
//
// Sobrevive a recargas de la PWA (IndexedDB): recargar a mitad de un
// turno offline recupera el estado desde aquí.

import { newId } from "./ids.js";
import { openAuthDb, STORE_SHIFT } from "./offlineAuth.js";

export interface LocalShift {
  localId: string;
  // null mientras el POST /shift/open no haya sincronizado. Una vez
  // resuelto, es el id real del turno en el server.
  serverId: string | null;
  cashOpening: number;
  openedAt: string; // ISO
  closedAt: string | null;
  // true = abierto sin red (nació local). false = espejo de un turno
  // que ya existía en el server (login online).
  openedOffline: boolean;
}

const KEY = "current";

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("IndexedDB request (shift) falló"));
  });
}

async function withShiftStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openAuthDb();
  const tx = db.transaction(STORE_SHIFT, mode);
  const result = await fn(tx.objectStore(STORE_SHIFT));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx (shift) falló"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB tx (shift) abortada"));
  });
  return result;
}

async function read(): Promise<LocalShift | null> {
  const rec = await withShiftStore("readonly", (store) =>
    reqToPromise(
      store.get(KEY) as IDBRequest<(LocalShift & { key: string }) | undefined>,
    ),
  );
  if (!rec) return null;
  const { key: _key, ...shift } = rec;
  void _key;
  return shift;
}

async function write(shift: LocalShift): Promise<void> {
  await withShiftStore("readwrite", (store) =>
    reqToPromise(store.put({ key: KEY, ...shift })),
  );
}

export async function getLocalShift(): Promise<LocalShift | null> {
  return read();
}

/** Abre un turno EN LOCAL (sin red). Genera el localId que servirá de
 *  externalId de idempotencia para el POST /shift/open encolado. */
export async function openLocalShift(
  cashOpening: number,
  now: number = Date.now(),
): Promise<LocalShift> {
  const shift: LocalShift = {
    localId: newId(),
    serverId: null,
    cashOpening,
    openedAt: new Date(now).toISOString(),
    closedAt: null,
    openedOffline: true,
  };
  await write(shift);
  return shift;
}

/** Espejo local de un turno que YA existe en el server (login online o
 *  reanudar). serverId === localId (no hay id local separado). */
export async function mirrorServerShift(server: {
  id: string;
  openedAt: string;
  cashOpening: string | number;
}): Promise<LocalShift> {
  const shift: LocalShift = {
    localId: server.id,
    serverId: server.id,
    cashOpening:
      typeof server.cashOpening === "number"
        ? server.cashOpening
        : parseFloat(server.cashOpening) || 0,
    openedAt: server.openedAt,
    closedAt: null,
    openedOffline: false,
  };
  await write(shift);
  return shift;
}

/** El POST /shift/open sincronizó: fijamos el serverId real. Idempotente
 *  (no-op si el turno actual no es el que se resolvió). */
export async function resolveLocalShift(
  localId: string,
  serverId: string,
): Promise<void> {
  const current = await read();
  if (!current || current.localId !== localId) return;
  await write({ ...current, serverId });
}

export async function closeLocalShift(now: number = Date.now()): Promise<void> {
  const current = await read();
  if (!current) return;
  await write({ ...current, closedAt: new Date(now).toISOString() });
}

export async function clearLocalShift(): Promise<void> {
  await withShiftStore("readwrite", (store) => reqToPromise(store.delete(KEY)));
}

/** Lookup que registra el outbox para etiquetar items: dado el shiftId
 *  que lleva un item (body.shiftId de un ticket, o el :id de un arqueo),
 *  devuelve el localId del turno local SIN RESOLVER al que pertenece, o
 *  null si no es un turno local o ya está resuelto (en cuyo caso el
 *  shiftId ya es el del server y no hay que reescribir nada). */
export async function localShiftIdForOutbox(
  shiftId: string,
): Promise<string | null> {
  const current = await read();
  if (!current) return null;
  if (current.serverId !== null) return null; // ya resuelto
  return current.localId === shiftId ? current.localId : null;
}
