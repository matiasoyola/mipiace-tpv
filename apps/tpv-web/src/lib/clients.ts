// CRM / ficha de cliente (B-reservas-1) · caché local + capa de API.
//
// El cliente es fuente de verdad LOCAL (ADR-R2). La búsqueda A–Z debe
// funcionar sin red (ADR-001 offline-first): se cachea la ficha en
// IndexedDB (base `mipiacetpv-clients`, separada del catálogo para
// sobrevivir a los version-check que limpian el catálogo) y se filtra
// sobre el caché para dar feedback <100 ms; el sync en background trae
// las novedades del servidor. El alta offline entra en la cola outbox
// como el resto de mutaciones.

import { apiWithCashier, ApiError } from "../api.js";
import { newId } from "./ids.js";
import { outboxAdd } from "./outbox.js";

export interface ClientRow {
  id: string;
  externalId: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  // YYYY-MM-DD o null.
  birthdate: string | null;
  holdedContactId: string | null;
  marketingOptIn: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  // Metadato local: "synced" viene del server; "pending" es un alta
  // offline que aún no confirmó el outbox. El listado lo usa para pintar
  // un indicador "sin conexión" en la fila.
  syncState?: "synced" | "pending";
}

export interface ClientConsent {
  id: string;
  kind: "DATA" | "TREATMENT";
  grantedAt: string;
  docRef: string | null;
}

export interface ClientTechnicalNote {
  id: string;
  serviceId: string | null;
  body: string;
  createdByUserId: string;
  createdAt: string;
}

export interface ClientDetail {
  client: ClientRow;
  consents: ClientConsent[];
  technicalNotes: ClientTechnicalNote[];
}

// `GET /clients/:id/history` devuelve un array UNIFICADO de compras y citas
// desde B-reservas-4 (`crm/routes.ts`: `[...purchaseEntries,
// ...appointmentEntries]`). El tipo de aquí decía que todo era una compra, y
// la pantalla leía `e.total` en todas: con una cita dentro, la ficha del
// cliente reventaba entera (`Cannot read properties of undefined (reading
// 'toLocaleString')` → pantalla del ErrorBoundary).
//
// Lo encontró el banco de clinica-2 al abrir la ficha de una paciente que
// tenía cita y ninguna compra. Es un fallo de master, no del bloque, y
// afecta a cualquier tenant con la agenda encendida.
export type HistoryEntry =
  | {
      kind: "PURCHASE";
      id: string;
      at: string;
      ticketId: string;
      internalNumber: string;
      holdedDocNumber: string | null;
      status: string;
      total: number;
    }
  | {
      kind: "APPOINTMENT";
      id: string;
      at: string;
      end: string;
      status: string;
      ticketId: string | null;
      serviceIds: string[];
    };

export interface ClientHistory {
  entries: HistoryEntry[];
  // Contratos estables vacíos hasta B4/B5.
  appointments: unknown[];
  voucherMovements: unknown[];
}

export interface ClientVouchers {
  balance: { sessionsLeft: number; amountLeftCents: number };
  vouchers: unknown[];
}

export function clientFullName(c: {
  firstName: string;
  lastName: string;
}): string {
  return `${c.firstName} ${c.lastName}`.trim();
}

// ─── IndexedDB (con fallback a localStorage) ─────────────────────────

const DB_NAME = "mipiacetpv-clients";
const STORE = "clients";
const VERSION = 1;
const LS_KEY = "mipiacetpv-clients-fallback";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("phone", "phone", { unique: false });
        store.createIndex("lastName", "lastName", { unique: false });
      }
    };
    req.onerror = () => resolve(null);
    req.onsuccess = () => resolve(req.result);
  });
}

export async function loadClientsFromCache(): Promise<ClientRow[]> {
  const db = await openDb();
  if (!db) {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as ClientRow[];
    } catch {
      return [];
    }
  }
  return new Promise<ClientRow[]>((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as ClientRow[]);
    req.onerror = () => resolve([]);
  });
}

async function writeAll(items: ClientRow[]): Promise<void> {
  const db = await openDb();
  if (!db) {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    const store = tx.objectStore(STORE);
    store.clear();
    for (const it of items) store.put(it);
  });
}

export async function upsertClientInCache(client: ClientRow): Promise<void> {
  const db = await openDb();
  if (!db) {
    const all = await loadClientsFromCache();
    const next = all.filter((c) => c.id !== client.id);
    next.push(client);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.objectStore(STORE).put(client);
  });
}

// ─── Búsqueda local (feedback <100 ms) ───────────────────────────────

/**
 * Ordena A–Z por apellido, luego nombre.
 *
 * B-reservas-mostrador F3 · **el apellido puede estar vacío**, y una cadena
 * vacía ordena ANTES que cualquier letra: sin esto, todas las clientas que
 * Sole apunta por el nombre de pila se amontonaban al principio de la lista,
 * que es justo donde no se las busca. La clave de orden es «el apellido, o el
 * nombre si no hay apellido»: Sole (sin apellido) cae entre Soto y Suárez,
 * que es donde la recepcionista va a mirar.
 *
 * Este es EL A–Z que se ve. El `orderBy` de `GET /clients` es el orden del
 * cursor de paginación: `refreshClients()` se baja el tenant entero al caché
 * y la lista se pinta desde aquí.
 */
export function clientSortKey(c: { firstName: string; lastName: string }): string {
  return (c.lastName.trim() || c.firstName.trim());
}

export function sortClientsAz(items: ClientRow[]): ClientRow[] {
  return [...items].sort(
    (a, b) =>
      clientSortKey(a).localeCompare(clientSortKey(b), "es") ||
      a.firstName.localeCompare(b.firstName, "es"),
  );
}

export function searchClientsLocal(
  items: ClientRow[],
  query: string,
  limit = 50,
): ClientRow[] {
  const needle = query.trim().toLowerCase();
  const base = needle
    ? items.filter(
        (c) =>
          c.firstName.toLowerCase().includes(needle) ||
          c.lastName.toLowerCase().includes(needle) ||
          (c.phone ?? "").toLowerCase().includes(needle) ||
          (c.email ?? "").toLowerCase().includes(needle),
      )
    : items;
  return sortClientsAz(base).slice(0, limit);
}

// ─── ¿Hay que volver a bajarse los clientes? ──────────────────────────
//
// agenda-lista (hallazgo 🟡 1) · hasta este bloque el caché de clientes lo
// llenaba SÓLO la pantalla Clientes. En un dispositivo recién emparejado
// —que es el estado exacto del AP11 el primer día en casa de Sole— la
// agenda pintaba «09:00 · Sin nombre» en todas las citas hasta que a
// alguien se le ocurría abrir Clientes una vez. La recepción abre la
// agenda y no sabe de quién es la cita de las diez.
//
// La decisión de refrescar se saca aparte, pura y sin IndexedDB, porque
// es lo único de esto que se puede probar sin navegador.

const LAST_SYNC_KEY = "mipiacetpv-clients-last-sync";

/**
 * Cuánto se da por buena la última bajada antes de volver a pedirla.
 *
 * 15 minutos es un compromiso, y conviene decir contra qué: la agenda se
 * abre y se cierra decenas de veces en un turno, y `refreshClients()` se
 * baja el tenant ENTERO paginando. Refrescar en cada apertura castigaría
 * al WiFi del local sin ganar casi nada —una ficha dada de alta en ESTE
 * dispositivo ya entra en el caché por `upsertClientInCache`—, y lo que
 * esta ventana cubre es la clienta que dio de alta otra persona desde
 * otro mostrador hace un rato.
 */
export const CLIENTS_CACHE_TTL_MS = 15 * 60_000;

export function readClientsLastSyncAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeClientsLastSyncAt(ts: number): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(ts));
  } catch {
    // Sin almacenamiento se vive: se refrescará de más, no de menos.
  }
}

/**
 * Pura. `true` si merece la pena pedirle los clientes al servidor.
 *
 * Tres casos, y el orden importa:
 *   · caché vacío → SÍ, siempre. Es el dispositivo recién emparejado.
 *   · caché lleno pero sin marca de cuándo se llenó → SÍ. La marca nació
 *     en este bloque, así que un TPV que viene de una versión anterior
 *     tiene caché y no tiene marca: una vez y ya.
 *   · caché lleno y marca dentro de la ventana → NO.
 *
 * Una marca en el futuro (reloj del hierro movido hacia atrás) cuenta
 * como vencida: `ahora - ultimaSync` sale negativo y no pasa el `>=`, así
 * que se compara el valor absoluto.
 */
export function necesitaRefrescoDeClientes(args: {
  enCache: number;
  ultimaSync: number | null;
  ahora: number;
  ttlMs?: number;
}): boolean {
  const { enCache, ultimaSync, ahora, ttlMs = CLIENTS_CACHE_TTL_MS } = args;
  if (enCache === 0) return true;
  if (ultimaSync == null) return true;
  return Math.abs(ahora - ultimaSync) >= ttlMs;
}

/**
 * Se asegura de que el caché de clientes sirve, y si no lo rellena.
 *
 * Reutiliza `refreshClients()` —la MISMA función que usa la pantalla
 * Clientes, con su mezcla de altas offline incluida— en vez de duplicar
 * la llamada. Devuelve `true` si bajó algo, para que quien la llame
 * sepa si tiene que repintar.
 *
 * Sin red no rompe nada: se queda con lo que hubiera en el caché. Una
 * agenda que no abre porque no hay WiFi sería peor que una agenda con
 * algún «Sin nombre».
 */
export async function asegurarClientesEnCache(
  ahora: number = Date.now(),
): Promise<boolean> {
  const enCache = (await loadClientsFromCache()).length;
  if (
    !necesitaRefrescoDeClientes({
      enCache,
      ultimaSync: readClientsLastSyncAt(),
      ahora,
    })
  ) {
    return false;
  }
  try {
    await refreshClients(ahora);
    return true;
  } catch {
    return false;
  }
}

// ─── Sync con el servidor ─────────────────────────────────────────────

// Descarga todos los clientes del tenant paginando por cursor y reemplaza
// el caché local. Preserva las altas pendientes (offline) que el server
// todavía no conoce, para que no desaparezcan de la lista al sincronizar.
export async function refreshClients(
  // agenda-lista · el instante con el que se sella la marca. Por defecto
  // el reloj, y explícito cuando quien llama ya tiene uno
  // (`asegurarClientesEnCache`): dos relojes distintos en la misma
  // decisión es cómo un caché recién bajado nace vencido.
  ahora: number = Date.now(),
): Promise<ClientRow[]> {
  const acc: ClientRow[] = [];
  let cursor: string | undefined;
  for (let safety = 0; safety < 200; safety++) {
    const res = await apiWithCashier<{
      items: ClientRow[];
      nextCursor: string | null;
    }>(`/clients?sort=az&limit=200${cursor ? `&cursor=${cursor}` : ""}`);
    for (const it of res.items) acc.push({ ...it, syncState: "synced" });
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  // Conserva altas offline aún pendientes (no llegaron al server).
  const local = await loadClientsFromCache();
  const serverExternalIds = new Set(
    acc.map((c) => c.externalId).filter(Boolean),
  );
  const pending = local.filter(
    (c) =>
      c.syncState === "pending" &&
      !(c.externalId && serverExternalIds.has(c.externalId)),
  );
  const merged = [...acc, ...pending];
  await writeAll(merged);
  // agenda-lista · la marca se pone AQUÍ y no en quien llama: así vale
  // igual si el refresco lo pidió la pantalla Clientes o la agenda, y no
  // hay forma de refrescar sin dejar constancia.
  writeClientsLastSyncAt(ahora);
  return merged;
}

export interface CreateClientInput {
  firstName: string;
  // B-reservas-mostrador F3 · opcional. La API ya no lo exige y la columna
  // guarda "" — sin migración.
  lastName?: string;
  phone?: string;
  email?: string;
  birthdate?: string;
  marketingOptIn?: boolean;
  notes?: string;
  holdedContactId?: string;
}

export interface CreateClientResult {
  client: ClientRow;
  // Otros clientes con el mismo teléfono (aviso no bloqueante).
  phoneWarning?: Array<{ id: string; name: string }>;
  // true si el alta quedó en la cola offline (sin red).
  queuedOffline?: boolean;
}

// Alta de cliente. Intenta online; si falla por red, persiste una fila
// optimista en el caché y encola el POST en el outbox (idempotente por
// externalId). Devuelve siempre una fila utilizable por la UI.
export async function createClient(
  input: CreateClientInput,
): Promise<CreateClientResult> {
  const externalId = newId();
  const body: Record<string, unknown> = {
    externalId,
    firstName: input.firstName,
    // Se manda siempre, aunque sea "": la columna es NOT NULL y el outbox
    // reenvía este mismo cuerpo tal cual.
    lastName: input.lastName ?? "",
  };
  if (input.phone) body.phone = input.phone;
  if (input.email) body.email = input.email;
  if (input.birthdate) body.birthdate = input.birthdate;
  if (input.marketingOptIn !== undefined) body.marketingOptIn = input.marketingOptIn;
  if (input.notes) body.notes = input.notes;
  if (input.holdedContactId) body.holdedContactId = input.holdedContactId;

  try {
    const res = await apiWithCashier<{
      client: ClientRow;
      phoneWarning?: Array<{ id: string; name: string }>;
    }>("/clients", { method: "POST", body });
    const client: ClientRow = { ...res.client, syncState: "synced" };
    await upsertClientInCache(client);
    return { client, phoneWarning: res.phoneWarning };
  } catch (err) {
    // Sólo degradamos a offline ante fallo de red / servidor caído; un
    // 400/validación se propaga para que el formulario lo muestre.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      throw err;
    }
    const now = new Date().toISOString();
    const optimistic: ClientRow = {
      id: externalId,
      externalId,
      firstName: input.firstName,
      lastName: input.lastName ?? "",
      phone: input.phone ?? null,
      email: input.email ?? null,
      birthdate: input.birthdate ?? null,
      holdedContactId: input.holdedContactId ?? null,
      marketingOptIn: input.marketingOptIn ?? false,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
      syncState: "pending",
    };
    await upsertClientInCache(optimistic);
    await outboxAdd({
      externalId,
      kind: "client",
      path: "/clients",
      body,
      label: `Cliente: ${clientFullName({ ...input, lastName: input.lastName ?? "" })}`,
      total: 0,
    });
    return { client: optimistic, queuedOffline: true };
  }
}

export interface UpdateClientInput {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  email?: string | null;
  birthdate?: string | null;
  marketingOptIn?: boolean;
  notes?: string | null;
  holdedContactId?: string | null;
}

export async function updateClient(
  id: string,
  patch: UpdateClientInput,
): Promise<ClientRow> {
  const res = await apiWithCashier<{ client: ClientRow }>(`/clients/${id}`, {
    method: "PATCH",
    body: patch,
  });
  const client: ClientRow = { ...res.client, syncState: "synced" };
  await upsertClientInCache(client);
  return client;
}

export async function getClientDetail(id: string): Promise<ClientDetail> {
  return apiWithCashier<ClientDetail>(`/clients/${id}`);
}

export async function getClientHistory(id: string): Promise<ClientHistory> {
  return apiWithCashier<ClientHistory>(`/clients/${id}/history`);
}

export async function getClientVouchers(id: string): Promise<ClientVouchers> {
  return apiWithCashier<ClientVouchers>(`/clients/${id}/vouchers`);
}

export async function addClientConsent(
  id: string,
  kind: "DATA" | "TREATMENT",
  docRef?: string,
): Promise<ClientConsent> {
  const res = await apiWithCashier<{ consent: ClientConsent }>(
    `/clients/${id}/consents`,
    { method: "POST", body: { kind, ...(docRef ? { docRef } : {}) } },
  );
  return res.consent;
}

export async function addClientTechnicalNote(
  id: string,
  body: string,
  serviceId?: string,
): Promise<ClientTechnicalNote> {
  const res = await apiWithCashier<{ technicalNote: ClientTechnicalNote }>(
    `/clients/${id}/technical-notes`,
    { method: "POST", body: { body, ...(serviceId ? { serviceId } : {}) } },
  );
  return res.technicalNote;
}
