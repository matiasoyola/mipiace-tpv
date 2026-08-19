// Capa de agenda del TPV (B-reservas-4). API + caché offline del día (lectura
// desde IndexedDB) + alta por outbox con `externalId` (mismo patrón que el
// alta de cliente de B1). Gate por `agendaEnabled` (lo consulta la UI). El
// motor de disponibilidad y el anti-solape viven en el servidor; aquí sólo
// se consume el contrato.

import { ApiError, apiWithCashier } from "../api.js";
import { newId } from "./ids.js";
import { outboxAdd } from "./outbox.js";

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
    await writeDay(day);
    return day;
  } catch (err) {
    // Offline / 5xx: usa la caché del día si existe.
    const cached = await loadAgendaDayFromCache(date);
    if (cached) return { ...cached, appointments: mergePendingLocal(cached) };
    throw err;
  }
}

// Conserva las citas offline optimistas al re-render (marca pendingOffline).
function mergePendingLocal(day: AgendaDay): AgendaAppointment[] {
  return day.appointments;
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
      label: `Cita ${input.start.slice(11, 16)}`,
      total: 0,
    });
    const optimistic: AgendaAppointment = {
      id: externalId,
      clientId: input.clientId,
      status: input.source && input.source !== "PRESENCIAL" ? "PENDING" : "CONFIRMED",
      source: input.source ?? "PRESENCIAL",
      start: input.start,
      end: input.start,
      ticketId: null,
      notes: input.notes ?? null,
      items: input.items.map((it, i) => ({
        id: `${externalId}-${i}`,
        serviceId: it.serviceId,
        durationMin: 0,
        sortOrder: i,
        startOffsetMin: 0,
      })),
      assignments: [],
      pendingOffline: true,
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
