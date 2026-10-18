// residencia-5 (D-67) · **LA CACHÉ DE LA TABLET DE LA SALA.**
//
// Lo que la tablet guarda para poder enseñar el parte y confirmarlo **sin
// red**: el parte congelado entero, el roster con el que se resuelve el
// PIN y las zonas de cada persona, con las que se recorta.
//
// ── NO SE INVENTA OTRO MECANISMO ────────────────────────────────────
//
// IndexedDB con base propia (`mipiacetpv-sala`) y **fuera de
// `IDB_NAMES_TO_CLEAR`**, exactamente igual que la caché de la puerta y
// por lo mismo: lo que permite funcionar sin red tiene que sobrevivir a
// un despliegue. Y el mismo fallback a `localStorage` para el navegador
// que no expone IDB.
//
// ── POR QUÉ CACHEA EL PARTE, QUE ES SALUD ───────────────────────────
//
// Porque es la mitad del bloque. El prompt lo pide con estas palabras:
// «sin red, el parte congelado se cachea al generarse y la confirmación
// se encola con la cola de siempre». Una tablet de sala sin red que no
// pudiera enseñar el parte dejaría la reunión de cambio de turno como
// está hoy: de palabra.
//
// Y es la misma decisión que la puerta tomó con el plan de cuidados de
// dos residentes (residencia-3 §7), con las mismas dos condiciones:
//
//   1. **la pantalla en reposo no lo pinta** — nada de salud antes del
//      PIN;
//   2. **se vacía al revocar el dispositivo** (`olvidarLaSala`), que lo
//      llama el arranque cuando `/devices/me` dice que el aparato ya no
//      está emparejado.

import type { SalaArranque } from "./sala-tipos.js";

const DB_NAME = "mipiacetpv-sala";
const DB_VERSION = 1;
const STORE = "arranque";
const CLAVE = "arranque";
const LS_KEY = "mipiacetpv-sala-arranque";

let dbPromise: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(req.error ?? new Error("IndexedDB open (sala) falló"));
    });
  }
  return dbPromise;
}

function comoPromesa<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("IndexedDB request (sala) falló"));
  });
}

async function conStore<T>(
  modo: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await abrir();
  const tx = db.transaction(STORE, modo);
  const res = await fn(tx.objectStore(STORE));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("tx (sala) falló"));
    tx.onabort = () => reject(tx.error ?? new Error("tx (sala) abortada"));
  });
  return res;
}

export async function guardarArranqueDeSala(a: SalaArranque): Promise<void> {
  try {
    await conStore("readwrite", (store) => comoPromesa(store.put(a, CLAVE)));
    return;
  } catch {
    /* sin IDB — se cae al localStorage */
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(a));
  } catch {
    /* cuota llena: la sala sigue funcionando CON red, y sin red dirá que
       no tiene nada cacheado. Es lo peor que puede pasar y no debe
       tumbar la pantalla. */
  }
}

export async function leerArranqueDeSala(): Promise<SalaArranque | null> {
  try {
    const v = await conStore("readonly", (store) =>
      comoPromesa(store.get(CLAVE) as IDBRequest<SalaArranque | undefined>),
    );
    if (v) return v;
  } catch {
    /* sin IDB */
  }
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SalaArranque;
  } catch {
    return null;
  }
}

/** Al revocar el dispositivo. Dentro hay el parte de un turno entero. */
export async function olvidarLaSala(): Promise<void> {
  try {
    await conStore("readwrite", (store) => comoPromesa(store.delete(CLAVE)));
  } catch {
    /* ya no estaba */
  }
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ya no estaba */
  }
}

// ── La sesión de la sala ─────────────────────────────────────────────
//
// ── DOS COSAS, Y NO SE CONFUNDEN ────────────────────────────────────
//
//   · la **sesión de pantalla** — lo que se está leyendo. Se cierra sola
//     a los DOS minutos sin tocar y al pulsar «Terminar». Vive en
//     memoria.
//   · el **token** — lo que la cola necesita para subir la confirmación
//     que se firmó sin red. Vive aquí, y NO se borra al pulsar
//     «Terminar».
//
// Si «Terminar» borrara el token, pulsarlo con una confirmación en la
// cola la dejaría esperando a que alguien volviera a teclear un PIN — y
// la cola puede tener que salir cuando vuelva el wifi y no haya nadie
// delante. Es la misma razón, palabra por palabra, que en la puerta.

const SESION_KEY = "mipiacetpv-sala-sesion";

export interface SesionDeSala {
  token: string;
  /** ms epoch, ya resuelto. */
  expiraEn: number;
  userId: string;
  nombre: string;
  careRoleAssignmentId: string;
  rolCode: string;
  rolName: string;
  /** D-51 · si ve todo el centro, y qué plantas si no. Es lo que recorta
   *  el parte sin red. */
  alcanceTotal: boolean;
  zonas: string[];
}

export function guardarSesionDeSala(s: SesionDeSala): void {
  try {
    localStorage.setItem(SESION_KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento: la sesión vive en memoria y la cola saldrá
       cuando alguien vuelva a entrar. */
  }
}

export function leerSesionDeSala(): SesionDeSala | null {
  const raw = localStorage.getItem(SESION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as SesionDeSala;
    if (typeof s.token !== "string" || s.expiraEn <= Date.now()) {
      localStorage.removeItem(SESION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function olvidarSesionDeSala(): void {
  try {
    localStorage.removeItem(SESION_KEY);
  } catch {
    /* ya no estaba */
  }
}
