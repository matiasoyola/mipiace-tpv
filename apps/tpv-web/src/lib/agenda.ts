// Capa de agenda del TPV (B-reservas-4). API + caché offline del día (lectura
// desde IndexedDB) + alta por outbox con `externalId` (mismo patrón que el
// alta de cliente de B1). Gate por `agendaEnabled` (lo consulta la UI). El
// motor de disponibilidad y el anti-solape viven en el servidor; aquí sólo
// se consume el contrato.

import { ApiError, apiWithCashier } from "../api.js";
import { newId } from "./ids.js";
import { outboxAdd, outboxList } from "./outbox.js";

// Zona horaria del centro para pintar. El motor tiene la suya
// (`apps/api/src/agenda/time.ts`); esto es el espejo del front, y vive
// aquí —no en la pantalla— para que la agenda y el outbox agrupen por el
// mismo día.
export const AGENDA_TZ = "Europe/Madrid";

const hhmmFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: AGENDA_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: AGENDA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** ISO UTC → "HH:MM" de pared del centro. */
export function centerHHMM(iso: string): string {
  return hhmmFmt.format(new Date(iso));
}

/** ISO UTC → "YYYY-MM-DD" de pared del centro. */
export function centerWallDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

/** Hoy, en fecha de pared del centro. */
export function centerToday(): string {
  return dateFmt.format(new Date());
}

export type AppointmentStatus =
  | "PENDING"
  | "CONFIRMED"
  | "IN_SERVICE"
  | "COMPLETED"
  | "NO_SHOW"
  | "CANCELLED";

export interface AgendaStaff {
  userId: string;
  displayName: string;
  color: string | null;
  active: boolean;
}

export interface AgendaAppointmentItem {
  id: string;
  serviceId: string;
  durationMin: number;
  sortOrder: number;
  startOffsetMin: number;
}

export interface AgendaAppointment {
  id: string;
  clientId: string | null;
  status: AppointmentStatus;
  source: string;
  start: string; // ISO UTC
  end: string; // ISO UTC
  ticketId: string | null;
  notes: string | null;
  items: AgendaAppointmentItem[];
  assignments: Array<{
    reservableType: "STAFF" | "RESOURCE" | "TABLE";
    staffUserId: string | null;
    resourceId: string | null;
  }>;
  // Marca local del alta offline aún no confirmada por el server.
  pendingOffline?: boolean;
  // B-reservas-6a frente O · en qué estado está esa alta local. Si el
  // servidor la rechazó (solape, o una hora que ya no se sostiene), la
  // cita NO puede desaparecer de la agenda en silencio: se queda pintada
  // con su motivo.
  outboxStatus?: "pending" | "rejected";
  outboxError?: string | null;
}

export interface AgendaDay {
  date: string; // YYYY-MM-DD
  staff: AgendaStaff[];
  appointments: AgendaAppointment[];
}

export interface AvailabilitySlot {
  start: string;
  end: string;
  options: number;
}

// ── Caché offline del día (IndexedDB, fallback localStorage) ──────────

const DB_NAME = "mipiacetpv-agenda";
const STORE = "days";
const VERSION = 1;
const LS_PREFIX = "mipiacetpv-agenda-day-";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "date" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function writeDay(day: AgendaDay): Promise<void> {
  const db = await openDb();
  if (!db) {
    try {
      localStorage.setItem(LS_PREFIX + day.date, JSON.stringify(day));
    } catch {
      /* cuota llena: se ignora, la caché es best-effort */
    }
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(day);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function loadAgendaDayFromCache(
  date: string,
): Promise<AgendaDay | null> {
  const db = await openDb();
  if (!db) {
    const raw = localStorage.getItem(LS_PREFIX + date);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AgendaDay;
    } catch {
      return null;
    }
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(date);
    req.onsuccess = () => resolve((req.result as AgendaDay) ?? null);
    req.onerror = () => resolve(null);
  });
}

// ── API ───────────────────────────────────────────────────────────────

// Trae el día del server y lo cachea. Si no hay red, cae a la caché.
export async function fetchAgendaDay(date: string): Promise<AgendaDay> {
  try {
    const res = await apiWithCashier<{
      staff: AgendaStaff[];
      appointments: AgendaAppointment[];
    }>(`/agenda?date=${date}`);
    const day: AgendaDay = {
      date,
      staff: res.staff,
      appointments: res.appointments,
    };
    // La caché guarda lo que dijo el SERVIDOR. Lo local se mezcla al
    // devolver, nunca se persiste: si se cacheara, una cita rechazada
    // sobreviviría a su propio item del outbox.
    await writeDay(day);
    return { ...day, appointments: await mergePendingLocal(day) };
  } catch (err) {
    // Offline / 5xx: usa la caché del día si existe.
    const cached = await loadAgendaDayFromCache(date);
    if (cached) {
      return { ...cached, appointments: await mergePendingLocal(cached) };
    }
    throw err;
  }
}

/**
 * Mezcla las altas que están en el outbox con lo que dice el servidor.
 *
 * B-reservas-6a frente O · esto ERA UN STUB (`return day.appointments`)
 * desde B4, con un comentario que decía que conservaba las citas
 * optimistas. No conservaba nada: una cita creada sin red se guardaba en
 * el outbox, la cajera veía un aviso de 3,5 segundos y **la agenda no la
 * pintaba nunca**. Y si el servidor la rechazaba al reconectar, lo único
 * que quedaba era el chip de abajo a la derecha.
 *
 * Ahora la cita encolada se pinta en su hueco, y la rechazada SE QUEDA
 * pintada con su motivo hasta que alguien la reintenta o la descarta. Una
 * cita escrita no se cae de la agenda en silencio.
 *
 * Se mezcla SIEMPRE, también con red: es online cuando más importa —el
 * servidor no la tiene, y sin esto el hueco se ve vacío.
 */
async function mergePendingLocal(day: AgendaDay): Promise<AgendaAppointment[]> {
  let items;
  try {
    items = await outboxList();
  } catch {
    return day.appointments; // sin IndexedDB, la agenda del servidor basta
  }
  const yaEnElServidor = new Set(day.appointments.map((a) => a.id));
  const locales: AgendaAppointment[] = [];
  for (const it of items) {
    if (it.kind !== "appointment" || (it.method ?? "POST") !== "POST") continue;
    const body = it.body as {
      clientId?: string | null;
      start?: string;
      notes?: string | null;
      source?: string;
      items?: Array<{ serviceId: string; staffUserId?: string | null }>;
    };
    if (typeof body.start !== "string") continue;
    if (centerWallDate(body.start) !== day.date) continue;
    // Ya subió y el servidor la devuelve con el id definitivo: el item
    // desaparece del outbox al 2xx, pero puede haber una ventana.
    if (yaEnElServidor.has(it.externalId)) continue;
    const bodyItems = body.items ?? [];
    locales.push({
      id: it.externalId,
      clientId: body.clientId ?? null,
      status: "CONFIRMED",
      source: body.source ?? "PRESENCIAL",
      start: body.start,
      end: new Date(
        new Date(body.start).getTime() + (it.durationMin ?? 0) * 60_000,
      ).toISOString(),
      ticketId: null,
      notes: body.notes ?? null,
      items: bodyItems.map((x, i) => ({
        id: `${it.externalId}-${i}`,
        serviceId: x.serviceId,
        durationMin: 0,
        sortOrder: i,
        startOffsetMin: 0,
      })),
      assignments: bodyItems
        .filter((x) => x.staffUserId)
        .map((x) => ({
          reservableType: "STAFF" as const,
          staffUserId: x.staffUserId!,
          resourceId: null,
        })),
      pendingOffline: true,
      outboxStatus: it.status,
      outboxError: it.lastError,
    });
  }
  return [...day.appointments, ...locales];
}

export async function searchAvailability(input: {
  items: Array<{ serviceId: string; staffUserId?: string | null }>;
  staffUserId?: string | null;
  from: string;
  to: string;
}): Promise<AvailabilitySlot[]> {
  const res = await apiWithCashier<{ slots: AvailabilitySlot[] }>(
    "/agenda/availability",
    { method: "POST", body: input },
  );
  return res.slots;
}

export interface CreateAppointmentInput {
  clientId: string | null;
  items: Array<{ serviceId: string; staffUserId?: string | null }>;
  start: string; // ISO UTC
  source?: "PRESENCIAL" | "WEB" | "PHONE" | "GIFT_REDEMPTION";
  notes?: string | null;
  // Duración total del visit. NO se envía (el schema del alta no la
  // acepta): viaja en el item del outbox para poder pintar la cita
  // encolada con su alto real mientras el servidor no la ha visto.
  durationMin?: number;
}

export type CreateAppointmentResult =
  | { ok: true; appointment: AgendaAppointment; queuedOffline?: boolean }
  | { ok: false; error: string; message: string; alternatives?: AvailabilitySlot[] };

// Alta de cita. Online-first; ante red caída (o 5xx) entra en el outbox con
// `externalId` (idempotente) y se devuelve una cita optimista. Los errores de
// negocio (409 NO_SLOT/TAKEN, 400) se propagan con sus alternativas.
export async function createAppointment(
  input: CreateAppointmentInput,
): Promise<CreateAppointmentResult> {
  const externalId = newId();
  const body = {
    externalId,
    clientId: input.clientId,
    items: input.items,
    start: input.start,
    source: input.source ?? "PRESENCIAL",
    notes: input.notes ?? null,
  };
  try {
    const res = await apiWithCashier<{ appointment: AgendaAppointment }>(
      "/agenda/appointments",
      { method: "POST", body },
    );
    return { ok: true, appointment: res.appointment };
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      // Error de negocio (hueco perdido, no agendable): NO va al outbox.
      const data = err.data as { alternatives?: AvailabilitySlot[] } | undefined;
      return {
        ok: false,
        error: err.code ?? "ERROR",
        message: err.message,
        alternatives: data?.alternatives,
      };
    }
    // Red caída / 5xx: encolar para reintento idempotente.
    await outboxAdd({
      externalId,
      kind: "appointment",
      path: "/agenda/appointments",
      body,
      // La hora de PARED del centro. Antes era `start.slice(11,16)`, que
      // es UTC: el chip decía "Cita 09:00" de una cita de las 11:00, y el
      // chip es justo donde la cajera lee lo que se rechazó.
      label: `Cita ${centerHHMM(input.start)}`,
      total: 0,
      durationMin: input.durationMin,
    });
    const optimistic: AgendaAppointment = {
      id: externalId,
      clientId: input.clientId,
      status: input.source && input.source !== "PRESENCIAL" ? "PENDING" : "CONFIRMED",
      source: input.source ?? "PRESENCIAL",
      start: input.start,
      end: new Date(
        new Date(input.start).getTime() + (input.durationMin ?? 0) * 60_000,
      ).toISOString(),
      ticketId: null,
      notes: input.notes ?? null,
      items: input.items.map((it, i) => ({
        id: `${externalId}-${i}`,
        serviceId: it.serviceId,
        durationMin: 0,
        sortOrder: i,
        startOffsetMin: 0,
      })),
      assignments: input.items
        .filter((it) => it.staffUserId)
        .map((it) => ({
          reservableType: "STAFF" as const,
          staffUserId: it.staffUserId!,
          resourceId: null,
        })),
      pendingOffline: true,
      outboxStatus: "pending",
      outboxError: null,
    };
    return { ok: true, appointment: optimistic, queuedOffline: true };
  }
}

export async function patchAppointment(
  id: string,
  change: { status?: AppointmentStatus; start?: string },
): Promise<
  | { ok: true; appointment: AgendaAppointment }
  | { ok: false; error: string; message: string; alternatives?: AvailabilitySlot[] }
> {
  try {
    const res = await apiWithCashier<{ appointment: AgendaAppointment }>(
      `/agenda/appointments/${id}`,
      { method: "PATCH", body: change },
    );
    return { ok: true, appointment: res.appointment };
  } catch (err) {
    if (err instanceof ApiError) {
      const data = err.data as { alternatives?: AvailabilitySlot[] } | undefined;
      return {
        ok: false,
        error: err.code ?? "ERROR",
        message: err.message,
        alternatives: data?.alternatives,
      };
    }
    throw err;
  }
}

export interface CheckoutTicketLine {
  id: string;
  productId: string | null;
  sku: string;
  nameSnapshot: string;
  units: string;
  unitPrice: string;
  taxRate: string;
  total: string;
}

export interface CheckoutTicket {
  id: string;
  externalId: string;
  status: string;
  total: string;
  totalTax: string;
  totalDiscount: string;
  lines: CheckoutTicketLine[];
}

// Cita → caja: abre el ticket pre-poblado por el camino de cobro existente.
export async function checkoutAppointmentTicket(
  id: string,
): Promise<
  | { ok: true; ticket: CheckoutTicket }
  | { ok: false; error: string; message: string }
> {
  try {
    const res = await apiWithCashier<{ ticket: CheckoutTicket }>(
      `/agenda/appointments/${id}/checkout`,
      { method: "POST", body: {} },
    );
    return { ok: true, ticket: res.ticket };
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, error: err.code ?? "ERROR", message: err.message };
    }
    throw err;
  }
}

// B-reservas-5 F4 · la cita se finaliza sola al cobrarse.
//
// Se hace en el FRONT a propósito: engancharlo dentro de
// `POST /tickets/:id/checkout` metería la agenda dentro del camino de
// cobro, que es justo lo que prohíben ADR-010 y ADR-R8 §5 (el motor
// alimenta ese camino, no lo toca). El front ya sabe que está en
// contexto de cita; que lo diga él.
//
// EL DINERO MANDA: si esto falla, el cobro sigue siendo válido. Un 4xx
// se devuelve para avisar (y queda "Finalizar" a mano en el detalle);
// una caída de red se encola en el outbox como PATCH y se reintenta al
// reconectar. Lo que no puede pasar es que se pierda en silencio.
//
// `PATCH { status: COMPLETED }` es idempotente por naturaleza: repetirlo
// deja la cita como ya estaba, así que el reintento del outbox no
// necesita un externalId que el server conozca.
export async function completeAppointment(
  id: string,
): Promise<
  | { ok: true; queuedOffline?: boolean }
  | { ok: false; error: string; message: string }
> {
  try {
    await apiWithCashier(`/agenda/appointments/${id}`, {
      method: "PATCH",
      body: { status: "COMPLETED" },
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      // Error de negocio (la cita ya no existe, estado no permitido): no
      // va al outbox, reintentarlo daría el mismo 4xx para siempre.
      return { ok: false, error: err.code ?? "ERROR", message: err.message };
    }
    await outboxAdd({
      externalId: newId(),
      kind: "appointment",
      method: "PATCH",
      path: `/agenda/appointments/${id}`,
      body: { status: "COMPLETED" },
      label: "Cita finalizada",
      total: 0,
    });
    return { ok: true, queuedOffline: true };
  }
}

// ── Helpers de presentación ───────────────────────────────────────────

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  IN_SERVICE: "En sala",
  COMPLETED: "Finalizada",
  NO_SHOW: "No-show",
  CANCELLED: "Cancelada",
};

// Colores por estado (mapeo del mockup agenda-reservas).
export const STATUS_COLOR: Record<AppointmentStatus, string> = {
  PENDING: "#f59e0b", // ámbar
  CONFIRMED: "#3b82f6", // azul
  IN_SERVICE: "#10b981", // verde
  COMPLETED: "#64748b", // gris
  NO_SHOW: "#ef4444", // rojo
  CANCELLED: "#cbd5e1", // gris claro
};
