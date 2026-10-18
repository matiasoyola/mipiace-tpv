// residencia-3 (decisión de producto 7) · LA CACHÉ DE LA PUERTA.
//
// Lo que la tablet guarda de SU habitación para poder pintar «lo que toca»
// y registrar **sin red**: residentes, plan vigente, ajustes del centro,
// turnos, momentos, catálogo vigente y el roster con el que se resuelve el
// PIN.
//
// ── NO SE INVENTA OTRO MECANISMO ────────────────────────────────────
//
// IndexedDB, como el paquete offline del TPV (`lib/offlineAuth.ts`, v1.10
// §1) y como el catálogo (`lib/catalog.ts`). Base propia
// (`mipiacetpv-puerta`) y **fuera de `IDB_NAMES_TO_CLEAR`** de
// `version-check.ts`, por lo mismo que el outbox y el paquete de auth: lo
// que permite registrar sin red tiene que sobrevivir a un despliegue. Una
// tablet que se queda sin caché justo cuando se actualiza la APK es una
// tablet que no sabe qué toca en el turno de noche.
//
// ── Y SE VACÍA AL REVOCAR EL DISPOSITIVO ────────────────────────────
//
// `olvidarLaPuerta()` lo llama el arranque cuando `/devices/me` contesta
// que el aparato está revocado (`clearAllDeviceState`). Dentro hay el plan
// de dos personas y el roster del centro: una tablet desemparejada no se
// queda con eso.
//
// ── Qué NO se guarda ────────────────────────────────────────────────
//
// El **token de sesión** no vive aquí sino en `localStorage`, y es
// deliberado: es lo único que caduca solo, y mezclar en la misma base algo
// con fecha de caducidad y algo que tiene que sobrevivir a todo invita a
// borrar lo que no toca. Y la **DEK** del centro no sale nunca de la API:
// lo que viaja es la subclave del PIN, que no descifra nada.

import type { PuertaArranque } from "./puerta-tipos.js";

const DB_NAME = "mipiacetpv-puerta";
const DB_VERSION = 1;
const STORE = "arranque";
const CLAVE = "arranque";

/** Fallback a `localStorage` cuando el navegador no expone IndexedDB (modo
 *  privado restrictivo), igual que `lib/catalog.ts`. Sin esto, una tablet
 *  con IDB bloqueado no podría registrar sin red — y lo que importa aquí
 *  es que PUEDA, no que lo haga rápido. */
const LS_KEY = "mipiacetpv-puerta-arranque";

let dbPromise: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(req.error ?? new Error("IndexedDB open (puerta) falló"));
    });
  }
  return dbPromise;
}

function comoPromesa<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("IndexedDB request (puerta) falló"));
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
    tx.onerror = () => reject(tx.error ?? new Error("tx (puerta) falló"));
    tx.onabort = () => reject(tx.error ?? new Error("tx (puerta) abortada"));
  });
  return res;
}

/** Guarda el paquete de arranque. Se llama en cada arranque con red. */
export async function guardarArranque(a: PuertaArranque): Promise<void> {
  try {
    await conStore("readwrite", (store) =>
      comoPromesa(store.put(a, CLAVE)),
    );
    return;
  } catch {
    /* sin IDB — se cae al localStorage de abajo */
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(a));
  } catch {
    /* cuota llena: la puerta sigue funcionando CON red, y sin red dirá
       que no tiene nada cacheado. Es lo peor que puede pasar y no es un
       fallo que deba tumbar la pantalla. */
  }
}

/** Lo último que se guardó, o `null`. */
export async function leerArranque(): Promise<PuertaArranque | null> {
  try {
    const v = await conStore("readonly", (store) =>
      comoPromesa(store.get(CLAVE) as IDBRequest<PuertaArranque | undefined>),
    );
    if (v) return v;
  } catch {
    /* sin IDB */
  }
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PuertaArranque;
  } catch {
    return null;
  }
}

/** Al revocar el dispositivo. Dentro hay el plan de dos personas. */
export async function olvidarLaPuerta(): Promise<void> {
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

// ── La sesión de la puerta ───────────────────────────────────────────
//
// ── POR QUÉ EL TOKEN SOBREVIVE A «TERMINAR» ─────────────────────────
//
// Hay dos cosas y es importante no confundirlas:
//
//   · la **sesión de pantalla** — lo que se está pintando. Se cierra sola
//     al minuto sin tocar y al pulsar «Terminar» (decisión 8), y lo que
//     hace al cerrarse es volver a la pantalla 1: nada de salud en
//     pantalla. Vive en memoria.
//   · el **token** — lo que la cola necesita para subir lo que ya se
//     apuntó. Vive aquí, y NO se borra al pulsar «Terminar».
//
// Si «Terminar» borrara el token, pulsarlo con tres registros en la cola
// los dejaría esperando a que alguien volviera a teclear un PIN. Y la cola
// puede tener que salir a las tres de la mañana, cuando vuelva el wifi y
// no haya nadie delante. «Un cuidado hecho se apunta» incluye «y se
// envía».
//
// Lo que esto NO abre: el token solo no vale para nada. Las rutas exigen
// además el `X-Device-Token`, y la sesión está atada a ESTE dispositivo y
// a ESTA habitación (`requirePuertaSesion`).

const SESION_KEY = "mipiacetpv-puerta-sesion";

export interface SesionDePuerta {
  token: string;
  /** ms epoch. El servidor manda el TTL; aquí se guarda ya resuelto. */
  expiraEn: number;
  userId: string;
  nombre: string;
  careRoleAssignmentId: string;
  rolCode: string;
  rolName: string;
}

export function guardarSesion(s: SesionDePuerta): void {
  try {
    localStorage.setItem(SESION_KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento: la sesión vive sólo en memoria y la cola se
       enviará cuando alguien vuelva a entrar. */
  }
}

/** La sesión guardada, o `null` si no hay o ya caducó. */
export function leerSesion(): SesionDePuerta | null {
  const raw = localStorage.getItem(SESION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as SesionDePuerta;
    if (typeof s.token !== "string" || s.expiraEn <= Date.now()) {
      localStorage.removeItem(SESION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function olvidarSesion(): void {
  try {
    localStorage.removeItem(SESION_KEY);
  } catch {
    /* ya no estaba */
  }
}

// ── Resolver el PIN SIN RED ──────────────────────────────────────────

/**
 * ¿De quién es este PIN, según el roster cacheado?
 *
 * Recalcula la huella con la subclave del paquete de arranque y la busca
 * en el roster. Es **la misma huella** que calcula el servidor
 * (`huellaDePinDePuerta`), con la misma subclave y el mismo propósito
 * dentro: si las dos no coincidieran letra por letra, el PIN funcionaría
 * con red y no sin ella, que es el fallo que sólo se ve en una
 * implantación. Un test lo fija contra la función del servidor.
 *
 * `null` = ese PIN no es de nadie del roster, o no hay roster (el centro
 * no tiene clave clínica, o la tablet nunca arrancó con red).
 *
 * ── Lo que esta función NO hace, y es a propósito ─────────────────────
 *
 * **No verifica argon2id.** La credencial que el servidor comprueba es el
 * hash, y el hash **no viaja a la tablet** — al contrario que el roster
 * del TPV (v1.10 §1-2), que sí manda hashes. Aquí lo que viaja es la
 * huella, que no sirve para nada fuera de esta puerta.
 *
 * Lo que una tablet robada sí permite es probar las diez mil
 * combinaciones y aprender los PIN de la plantilla. Es la misma exposición
 * que el roster del TPV acepta y documenta, y la respuesta es la misma:
 * **la caché se vacía al revocar el dispositivo**, y el PIN no abre nada
 * más que la puerta de una habitación.
 */
export async function quienTeclea(
  pin: string,
  arranque: PuertaArranque,
): Promise<PuertaArranque["roster"][number] | null> {
  if (!arranque.pinSubclave) return null;
  const huella = await huellaDePinEnLaTablet(
    pin,
    arranque.pinSubclave,
    arranque.habitacion.tenantId,
  );
  if (huella == null) return null;
  return arranque.roster.find((r) => r.pinLookup === huella) ?? null;
}

/**
 * La huella del PIN, calculada en la tablet con `crypto.subtle`.
 *
 * **Las dos cadenas de propósito son las de `clinica/cripto.ts` y no
 * pueden cambiar en un lado solo.** Están escritas aquí otra vez porque la
 * alternativa era que el navegador importara de la API, y eso no existe;
 * es el mismo criterio con el que `turnoDeLaTablet` duplica `turnoDe`
 * (residencia-1 §7) y `packages/residencia-plan/src/tiempo.ts` duplica la
 * hora de pared de la agenda. Lo que las mantiene de acuerdo es un test
 * que calcula las dos y las compara.
 *
 * `null` si el navegador no tiene `crypto.subtle` (contexto no seguro). En
 * ese caso el PIN sólo se resuelve con red, y la pantalla lo dice.
 */
export async function huellaDePinEnLaTablet(
  pin: string,
  subclaveBase64: string,
  tenantId: string,
): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const bytes = Uint8Array.from(atob(subclaveBase64), (c) => c.charCodeAt(0));
  const clave = await subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await subtle.sign(
    "HMAC",
    clave,
    new TextEncoder().encode(`puerta-pin-v1|${tenantId}|${pin}`),
  );
  return [...new Uint8Array(firma)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Sólo tests: cierra la conexión cacheada. */
export async function __resetPuertaCacheForTests(): Promise<void> {
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      /* ya cerrada */
    }
  }
  dbPromise = null;
}
