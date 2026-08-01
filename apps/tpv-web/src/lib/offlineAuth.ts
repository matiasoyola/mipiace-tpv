// v1.10-offline-un-terminal §1-2 · Paquete offline de autenticación.
//
// Cachea en IndexedDB (`mipiacetpv-auth`) el roster de cajeros + config
// que devuelve GET /shift/offline-bundle, y verifica el PIN EN LOCAL
// (argon2id vía WASM) cuando no hay red. Emite una "sesión de cajero
// local" con expiración = cashierSessionTtlMinutes que habilita operar
// offline; al recuperar red, la capa de arriba renueva contra el server
// para obtener el JWT real que los POST del outbox necesitan.
//
// La BD `mipiacetpv-auth` está DELIBERADAMENTE fuera de
// IDB_NAMES_TO_CLEAR (version-check.ts): el paquete offline debe
// sobrevivir a deploys, igual que el outbox y el catálogo.
//
// MODELO DE CONFIANZA: cacheamos el HASH argon2id (nunca el PIN en
// claro) en un dispositivo YA bootstrapeado (deviceToken). El server
// sigue siendo la red de seguridad (idempotencia + re-login real al
// volver la red). El rate-limit local es un REFLEJO del server (5
// intentos → bloqueo), no un sustituto: quien controla el IndexedDB
// puede saltárselo, pero entonces se enfrenta al mismo argon2id de 64 MB
// que protege la BD del servidor.

import { argon2Verify } from "hash-wasm";

const DB_NAME = "mipiacetpv-auth";
const DB_VERSION = 1;
export const STORE_ROSTER = "roster";
export const STORE_CONFIG = "config";
export const STORE_SESSION = "session";
export const STORE_RATE_LIMIT = "rateLimit";
export const STORE_SHIFT = "shift"; // lo usa lib/offlineShift.ts

// Reflejo de la política del server (apps/api/src/auth/rate-limit.ts):
// 5 intentos en 5 min → bloqueo de 15 min.
export const MAX_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MS = 5 * 60_000;
export const LOCK_MS = 15 * 60_000;

export type CashierRole = "OWNER" | "MANAGER" | "CASHIER";

export interface RosterEntry {
  id: string;
  email: string;
  alias: string | null;
  role: CashierRole;
  pinHash: string;
}

export interface OfflineConfig {
  cashierSessionTtlMinutes: number;
  cashierAutoLogoutMinutes: number;
}

export interface OfflineBundle {
  registerId: string;
  config: OfflineConfig;
  roster: RosterEntry[];
  // shiftState lo consume lib/offlineShift.ts; aquí sólo guardamos
  // roster + config.
}

export interface LocalCashierSession {
  userId: string;
  email: string;
  alias: string | null;
  role: CashierRole;
  // ms epoch. La sesión local caduca a los cashierSessionTtlMinutes.
  expiresAt: number;
}

interface RateLimitRecord {
  email: string;
  attempts: number;
  windowStartMs: number;
  lockedUntilMs: number | null;
}

// ─── Plumbing IndexedDB ──────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

/** Abre (o crea) la BD `mipiacetpv-auth`. Exportada para que
 *  lib/offlineShift.ts comparta la misma conexión y esquema — todas las
 *  stores se crean en un único onupgradeneeded. */
export function openAuthDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_ROSTER)) {
          db.createObjectStore(STORE_ROSTER, { keyPath: "email" });
        }
        if (!db.objectStoreNames.contains(STORE_CONFIG)) {
          db.createObjectStore(STORE_CONFIG, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_SESSION)) {
          db.createObjectStore(STORE_SESSION, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_RATE_LIMIT)) {
          db.createObjectStore(STORE_RATE_LIMIT, { keyPath: "email" });
        }
        if (!db.objectStoreNames.contains(STORE_SHIFT)) {
          db.createObjectStore(STORE_SHIFT, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(req.error ?? new Error("IndexedDB open (auth) falló"));
    });
  }
  return dbPromise;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("IndexedDB request (auth) falló"));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openAuthDb();
  const tx = db.transaction(storeName, mode);
  const result = await fn(tx.objectStore(storeName));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx (auth) falló"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB tx (auth) abortada"));
  });
  return result;
}

// ─── Paquete offline (roster + config) ───────────────────────────────

/** Persiste el roster + config del paquete offline. Se llama en cada
 *  bootstrap online para refrescar el reflejo local. Reemplaza el roster
 *  entero (así los cajeros dados de baja o sin PIN desaparecen). */
export async function saveOfflineBundle(bundle: OfflineBundle): Promise<void> {
  await withStore(STORE_ROSTER, "readwrite", async (store) => {
    await reqToPromise(store.clear());
    for (const entry of bundle.roster) {
      await reqToPromise(store.put({ ...entry, email: entry.email.toLowerCase() }));
    }
  });
  await withStore(STORE_CONFIG, "readwrite", (store) =>
    reqToPromise(store.put({ key: "config", ...bundle.config })),
  );
}

export async function getOfflineConfig(): Promise<OfflineConfig | null> {
  const rec = await withStore(STORE_CONFIG, "readonly", (store) =>
    reqToPromise(
      store.get("config") as IDBRequest<
        (OfflineConfig & { key: string }) | undefined
      >,
    ),
  );
  if (!rec) return null;
  return {
    cashierSessionTtlMinutes: rec.cashierSessionTtlMinutes,
    cashierAutoLogoutMinutes: rec.cashierAutoLogoutMinutes,
  };
}

export async function getRosterEntry(email: string): Promise<RosterEntry | null> {
  const rec = await withStore(STORE_ROSTER, "readonly", (store) =>
    reqToPromise(
      store.get(email.toLowerCase()) as IDBRequest<RosterEntry | undefined>,
    ),
  );
  return rec ?? null;
}

/** ¿Tenemos algún paquete offline cacheado? Gate para ofrecer el
 *  fallback offline en el login. */
export async function hasOfflineBundle(): Promise<boolean> {
  const count = await withStore(STORE_ROSTER, "readonly", (store) =>
    reqToPromise(store.count()),
  );
  return count > 0;
}

// ─── Rate-limit local ────────────────────────────────────────────────

export interface RateLimitState {
  locked: boolean;
  lockedUntilMs: number | null;
  attemptsRemaining: number;
}

function freshRecord(email: string, now: number): RateLimitRecord {
  return { email, attempts: 0, windowStartMs: now, lockedUntilMs: null };
}

async function readRateLimit(email: string): Promise<RateLimitRecord | null> {
  const rec = await withStore(STORE_RATE_LIMIT, "readonly", (store) =>
    reqToPromise(
      store.get(email.toLowerCase()) as IDBRequest<RateLimitRecord | undefined>,
    ),
  );
  return rec ?? null;
}

async function writeRateLimit(rec: RateLimitRecord): Promise<void> {
  await withStore(STORE_RATE_LIMIT, "readwrite", (store) =>
    reqToPromise(store.put({ ...rec, email: rec.email.toLowerCase() })),
  );
}

/** Estado actual del rate-limit sin tocarlo (equivalente a `inspect`
 *  del server). Caduca ventana y candado por tiempo. */
export async function inspectRateLimit(
  email: string,
  now: number = Date.now(),
): Promise<RateLimitState> {
  const rec = await readRateLimit(email);
  if (!rec) return { locked: false, lockedUntilMs: null, attemptsRemaining: MAX_ATTEMPTS };
  if (rec.lockedUntilMs != null && rec.lockedUntilMs > now) {
    return { locked: true, lockedUntilMs: rec.lockedUntilMs, attemptsRemaining: 0 };
  }
  // Candado o ventana caducados → cuenta a cero.
  if (rec.lockedUntilMs != null && rec.lockedUntilMs <= now) {
    return { locked: false, lockedUntilMs: null, attemptsRemaining: MAX_ATTEMPTS };
  }
  if (now - rec.windowStartMs > ATTEMPT_WINDOW_MS) {
    return { locked: false, lockedUntilMs: null, attemptsRemaining: MAX_ATTEMPTS };
  }
  return {
    locked: false,
    lockedUntilMs: null,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - rec.attempts),
  };
}

async function registerFailure(
  email: string,
  now: number,
): Promise<RateLimitState> {
  const existing = await readRateLimit(email);
  let rec = existing ?? freshRecord(email, now);
  // Ventana o candado caducados → arrancamos ventana nueva.
  if (
    (rec.lockedUntilMs != null && rec.lockedUntilMs <= now) ||
    now - rec.windowStartMs > ATTEMPT_WINDOW_MS
  ) {
    rec = freshRecord(email, now);
  }
  rec.attempts += 1;
  if (rec.attempts >= MAX_ATTEMPTS) {
    rec.lockedUntilMs = now + LOCK_MS;
    await writeRateLimit(rec);
    return { locked: true, lockedUntilMs: rec.lockedUntilMs, attemptsRemaining: 0 };
  }
  await writeRateLimit(rec);
  return {
    locked: false,
    lockedUntilMs: null,
    attemptsRemaining: MAX_ATTEMPTS - rec.attempts,
  };
}

async function resetRateLimit(email: string): Promise<void> {
  await withStore(STORE_RATE_LIMIT, "readwrite", (store) =>
    reqToPromise(store.delete(email.toLowerCase())),
  );
}

// ─── Verificación de PIN local ───────────────────────────────────────

export type LocalLoginResult =
  | { ok: true; user: Omit<RosterEntry, "pinHash"> }
  | {
      ok: false;
      reason: "rate_limited" | "invalid" | "no_bundle";
      lockedUntilMs?: number;
      attemptsRemaining?: number;
    };

/** Verifica el PIN contra el pinHash cacheado (argon2id WASM). Aplica el
 *  rate-limit local (reflejo del server). NO emite sesión — eso lo hace
 *  el caller con setLocalCashierSession si el resultado es ok. */
export async function verifyPinLocal(
  email: string,
  pin: string,
  now: number = Date.now(),
): Promise<LocalLoginResult> {
  const pre = await inspectRateLimit(email, now);
  if (pre.locked) {
    return { ok: false, reason: "rate_limited", lockedUntilMs: pre.lockedUntilMs ?? undefined };
  }

  const entry = await getRosterEntry(email);
  if (!entry) {
    // No hay paquete offline (o el email no está en el roster). No
    // gastamos un intento del rate-limit: el fallo no es de credencial.
    const has = await hasOfflineBundle();
    return { ok: false, reason: has ? "invalid" : "no_bundle" };
  }

  let valid = false;
  try {
    valid = await argon2Verify({ password: pin, hash: entry.pinHash });
  } catch {
    valid = false;
  }
  if (!valid) {
    const state = await registerFailure(email, now);
    return {
      ok: false,
      reason: state.locked ? "rate_limited" : "invalid",
      lockedUntilMs: state.lockedUntilMs ?? undefined,
      attemptsRemaining: state.attemptsRemaining,
    };
  }

  await resetRateLimit(email);
  return {
    ok: true,
    user: { id: entry.id, email: entry.email, alias: entry.alias, role: entry.role },
  };
}

// ─── Sesión de cajero local ──────────────────────────────────────────

export async function setLocalCashierSession(
  user: Omit<RosterEntry, "pinHash">,
  ttlMinutes: number,
  now: number = Date.now(),
): Promise<LocalCashierSession> {
  const session: LocalCashierSession = {
    userId: user.id,
    email: user.email,
    alias: user.alias,
    role: user.role,
    expiresAt: now + ttlMinutes * 60_000,
  };
  await withStore(STORE_SESSION, "readwrite", (store) =>
    reqToPromise(store.put({ key: "current", ...session })),
  );
  return session;
}

export async function getLocalCashierSession(
  now: number = Date.now(),
): Promise<LocalCashierSession | null> {
  const rec = await withStore(STORE_SESSION, "readonly", (store) =>
    reqToPromise(
      store.get("current") as IDBRequest<
        (LocalCashierSession & { key: string }) | undefined
      >,
    ),
  );
  if (!rec) return null;
  if (rec.expiresAt <= now) return null;
  return {
    userId: rec.userId,
    email: rec.email,
    alias: rec.alias,
    role: rec.role,
    expiresAt: rec.expiresAt,
  };
}

export async function clearLocalCashierSession(): Promise<void> {
  await withStore(STORE_SESSION, "readwrite", (store) =>
    reqToPromise(store.delete("current")),
  );
}

// ─── Sólo tests ──────────────────────────────────────────────────────

export async function __resetOfflineAuthForTests(): Promise<void> {
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      /* ya cerrada */
    }
  }
  dbPromise = null;
}
