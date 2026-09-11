// Agenda del TPV (B-reservas-4). Tres superficies del mockup en un layout
// responsive: TPV/recepción = columnas por profesional (día) + tira de
// semana; móvil = "mi día" en 1 columna + filtro por profesional. Alta con
// panel al lado SIN scrim (no tapa el calendario), multi-servicio
// encadenable, cliente-first (useClientPicker de B1) y "Reservar y cobrar"
// (cita → caja). Detalle con cambio de estado + "Cobrar en caja".
//
// Gate por `agendaEnabled` en la UI (además del gate de ruta en el server).
// Offline: lectura del día desde caché; alta por outbox con externalId.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Plus, X } from "lucide-react";

import { ApiError } from "../api.js";
import { loadCatalogFromCache, type CatalogProduct } from "../lib/catalog.js";
import {
  clientFullName,
  loadClientsFromCache,
  type ClientRow,
} from "../lib/clients.js";
import {
  centerHHMM,
  centerToday,
  checkoutAppointmentTicket,
  createAppointment,
  fetchAgendaDay,
  loadAgendaDayFromCache,
  patchAppointment,
  searchAvailability,
  STATUS_COLOR,
  STATUS_LABEL,
  type AgendaAppointment,
  type AgendaDay,
  type AgendaStaff,
  type AppointmentStatus,
  type AvailabilitySlot,
} from "../lib/agenda.js";
import { useClientPicker } from "../hooks/useClientPicker.js";
import { outboxRetry, subscribeOutbox } from "../lib/outbox.js";

// ── Helpers de zona horaria (Europe/Madrid) para pintar ────────────────

const TZ = "Europe/Madrid";
// B-reservas-6a · la retícula del centro, la misma que el motor
// (`apps/api/src/agenda/time.ts::SLOT_MINUTES`). El suelo de la agenda es
// el comienzo de la franja EN CURSO: a las 11:10, las 11:00.
const SLOT_MIN = 15;
const dayStartMin = 8 * 60; // 08:00
const dayEndMin = 21 * 60; // 21:00
const PX_PER_MIN = 1.1;
// B-reservas-5 F8 · alto mínimo para que la tarjeta pueda pintar sus dos
// líneas enteras: 17 (hora + cliente) + 16 (servicios) + 8 de padding.
// Por debajo de esto se pinta sólo la primera.
const CARD_TWO_LINE_MIN_H = 41;

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// ISO UTC → minutos desde medianoche en hora local del centro.
function localMinutes(iso: string): number {
  const parts = partsFmt.formatToParts(new Date(iso));
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (hh === 24 ? 0 : hh) * 60 + mm;
}

// B-reservas-6a frente O · la hora de pared la da `lib/agenda.ts`, que es
// donde también la necesita el merge del outbox. Una copia menos.
const localHHMM = centerHHMM;

// minutos desde medianoche → "HH:MM" (para decir la hora del suelo).
function hhmm(minutes: number): string {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const todayLocalDate = centerToday;

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtDateHuman(dateStr: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${dateStr}T12:00:00.000Z`));
}

// Instante UTC a partir de fecha local + minutos de pared (para slot-first).
function localToIso(dateStr: string, minutes: number): string {
  // Reutiliza el mismo truco de offset que el server: interpretar como UTC y
  // corregir por el offset de Madrid.
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const guess = Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)),
    hh,
    mm,
  );
  const off = tzOffsetMs(new Date(guess));
  let result = guess - off;
  const off2 = tzOffsetMs(new Date(result));
  if (off2 !== off) result = guess - off2;
  return new Date(result).toISOString();
}

const offFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
function tzOffsetMs(date: Date): number {
  const parts = offFmt.formatToParts(date);
  const m: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") m[p.type] = Number(p.value);
  const hour = m.hour === 24 ? 0 : m.hour;
  const asUtc = Date.UTC(m.year!, m.month! - 1, m.day!, hour!, m.minute!, m.second!);
  return asUtc - date.getTime();
}

// ── Estado de la superficie de alta ────────────────────────────────────

interface DraftBooking {
  clientId: string | null;
  clientName: string | null;
  serviceIds: string[]; // servicios encadenados en orden
  staffUserId: string | null; // fijado en slot-first
  start: string | null; // ISO; null hasta elegir hueco
}

export interface AgendaPageProps {
  onClose: () => void;
  // Cita → caja: recibe las líneas del ticket pre-poblado para cargarlas en
  // el carrito y cobrar por el camino existente (SalePage). No toca el cobro.
  // B-reservas-5 F3 · "Cobrar en caja" ya no rehidrata líneas: abre el
  // DRAFT en el servidor y entrega su id. Quien manda en la navegación
  // (`App`) entra en contexto de borrador por el MISMO camino que usa la
  // mesa, y las líneas salen de `GET /tickets/:id` con el mapper que ya
  // existe (`tableDraft.ts::mapServerDraftLines`). Aquí no se escribe un
  // segundo mapper: el que había era una copia y ya había divergido
  // (perdía `holdedProductId`).
  // B-reservas-5 F4 · aviso que traer puesto al abrir (p.ej. "el cobro
  // se hizo bien pero la cita no se pudo finalizar"). Se enseña con el
  // toast que ya existe y se consume una sola vez.
  notice?: string | null;
  onNoticeShown?: () => void;
  onEnterDraft?: (entry: {
    appointmentId: string;
    ticketId: string;
    clientName: string | null;
    serviceLabel: string;
  }) => void;
}

export function AgendaPage({
  onClose,
  onEnterDraft,
  notice,
  onNoticeShown,
}: AgendaPageProps) {
  const [date, setDate] = useState<string>(todayLocalDate());
  const [day, setDay] = useState<AgendaDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [services, setServices] = useState<CatalogProduct[]>([]);
  const [clientsById, setClientsById] = useState<Map<string, ClientRow>>(new Map());
  const [staffFilter, setStaffFilter] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftBooking | null>(null);
  const [detail, setDetail] = useState<AgendaAppointment | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // B-reservas-6a · el 409 del suelo NO es un error genérico: trae la frase
  // que se le lee a la clienta y los tres huecos que sí se le pueden dar.
  // Vive en el panel de alta, que es donde está la acción que falló — un
  // toast abajo-centro deja a la cajera leyendo al otro lado de la tablet.
  const [bookError, setBookError] = useState<{
    message: string;
    alternatives: AvailabilitySlot[];
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const durationByService = useMemo(() => {
    const m = new Map<string, { name: string; durationMin: number }>();
    for (const s of services) {
      if (s.kind === "SERVICE") {
        m.set(s.id, { name: s.name, durationMin: s.durationMin ?? 0 });
      }
    }
    return m;
  }, [services]);

  const loadDay = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const fresh = await fetchAgendaDay(d);
      setDay(fresh);
      setOffline(false);
    } catch {
      const cached = await loadAgendaDayFromCache(d);
      setDay(cached ?? { date: d, staff: [], appointments: [] });
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDay(date);
  }, [date, loadDay]);

  // B-reservas-5 F4 · el aviso que viene de fuera (el cobro que no pudo
  // finalizar la cita) se enseña al abrir, que es cuando la cajera tiene
  // delante el botón "Finalizar".
  useEffect(() => {
    if (!notice) return;
    setToast(notice);
    const t = window.setTimeout(() => setToast(null), 6000);
    onNoticeShown?.();
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice]);

  // B-reservas-6a frente O · un alta encolada que el servidor acepta (o
  // rechaza) cambia lo que hay que pintar sin que nadie toque la pantalla.
  // El outbox avisa; la agenda se repinta.
  useEffect(() => {
    return subscribeOutbox(() => {
      void loadDay(date);
    });
  }, [date, loadDay]);

  useEffect(() => {
    void loadCatalogFromCache().then(setServices);
    void loadClientsFromCache().then((cs) => {
      setClientsById(new Map(cs.map((c) => [c.id, c])));
    });
  }, []);

  // Auto-scroll a la línea "ahora" al abrir el día de hoy.
  useEffect(() => {
    if (date === todayLocalDate() && scrollRef.current) {
      const now = localMinutes(new Date().toISOString());
      scrollRef.current.scrollTop = Math.max(
        0,
        (now - dayStartMin) * PX_PER_MIN - 120,
      );
    }
  }, [date, day]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  };

  const activeStaff = useMemo(
    () => (day?.staff ?? []).filter((s) => s.active),
    [day],
  );
  const columns = useMemo(() => {
    if (staffFilter) return activeStaff.filter((s) => s.userId === staffFilter);
    return activeStaff;
  }, [activeStaff, staffFilter]);

  // Las altas del outbox que el servidor rechazó. No se van solas de la
  // pantalla: la cajera tiene que poder verlas y decidir.
  const rechazadas = useMemo(
    () => (day?.appointments ?? []).filter((a) => a.outboxStatus === "rejected"),
    [day],
  );

  const clientName = (id: string | null): string => {
    if (!id) return "Sin cliente";
    const c = clientsById.get(id);
    return c ? clientFullName(c) : "Cliente";
  };

  const serviceNames = (a: AgendaAppointment): string =>
    a.items
      .map((it) => durationByService.get(it.serviceId)?.name ?? "Servicio")
      .join(" + ");

  // Citas por columna de profesional (una cita con K staff aparece en cada
  // columna que la atiende).
  const apptsByStaff = useMemo(() => {
    const m = new Map<string, AgendaAppointment[]>();
    for (const a of day?.appointments ?? []) {
      if (a.status === "CANCELLED") continue;
      const staffIds = new Set(
        a.assignments
          .filter((x) => x.reservableType === "STAFF" && x.staffUserId)
          .map((x) => x.staffUserId as string),
      );
      if (staffIds.size === 0) {
        const arr = m.get("__unassigned__") ?? [];
        arr.push(a);
        m.set("__unassigned__", arr);
      } else {
        for (const sid of staffIds) {
          const arr = m.get(sid) ?? [];
          arr.push(a);
          m.set(sid, arr);
        }
      }
    }
    return m;
  }, [day]);

  // ── Acciones ──────────────────────────────────────────────────────
  async function doCreate(cobrar: boolean) {
    if (!draft || draft.serviceIds.length === 0 || !draft.start) return;
    setBookError(null);
    const res = await createAppointment({
      clientId: draft.clientId,
      items: draft.serviceIds.map((serviceId) => ({
        serviceId,
        staffUserId: draft.staffUserId,
      })),
      start: draft.start,
      source: "PRESENCIAL",
      // Sólo para pintarla en su hueco mientras está encolada: el schema
      // del alta no acepta este campo y el outbox no lo envía.
      durationMin: draft.serviceIds.reduce(
        (sum, id) => sum + (durationByService.get(id)?.durationMin ?? 0),
        0,
      ),
    });
    if (!res.ok) {
      // El servidor ya redacta la frase (BOOKING_IN_PAST / BOOKING_OFF_GRID
      // y los que vengan): aquí no se reescribe, se enseña — con sus
      // alternativas tocables.
      setBookError({ message: res.message, alternatives: res.alternatives ?? [] });
      return;
    }
    setDraft(null);
    setBookError(null);
    if (res.queuedOffline) flash("Cita guardada sin red; se enviará al reconectar.");
    await loadDay(date);
    if (cobrar && !res.queuedOffline) {
      await doCheckout(res.appointment.id);
    }
  }

  async function doCheckout(appointmentId: string) {
    const res = await checkoutAppointmentTicket(appointmentId);
    if (!res.ok) {
      flash(res.message);
      return;
    }
    if (!onEnterDraft) {
      flash("Ticket pre-poblado abierto en caja.");
      return;
    }
    const appt =
      day?.appointments.find((a) => a.id === appointmentId) ?? detail ?? null;
    onEnterDraft({
      appointmentId,
      ticketId: res.ticket.id,
      clientName: appt ? clientName(appt.clientId) : null,
      serviceLabel: appt ? serviceNames(appt) : "",
    });
    onClose();
  }

  // Una cita que todavía vive en el outbox NO existe en el servidor:
  // abrir su detalle ofrecería "Cobrar en caja" sobre algo que no está.
  // Se cuenta lo que le pasa, que es lo que la cajera necesita saber.
  function abrirCita(a: AgendaAppointment) {
    if (!a.pendingOffline) {
      setDetail(a);
      return;
    }
    flash(
      a.outboxStatus === "rejected"
        ? `No se pudo guardar: ${a.outboxError ?? "el servidor la rechazó"}`
        : "Cita guardada sin red; se enviará al reconectar.",
    );
  }

  async function changeStatus(id: string, status: AppointmentStatus) {
    const res = await patchAppointment(id, { status });
    if (!res.ok) {
      flash(res.message);
      return;
    }
    setDetail(res.appointment);
    await loadDay(date);
  }

  // Tap en un hueco vacío de una columna → alta slot-first.
  function openSlotFirst(staffUserId: string | null, minutes: number) {
    const snapped = Math.round(minutes / SLOT_MIN) * SLOT_MIN;
    // B-reservas-6a · una franja pasada NO invita a crear una cita. El
    // servidor la rechazaría igual (409 BOOKING_IN_PAST); enseñar el panel
    // de alta para acabar en un error es pasear a la cajera delante de la
    // clienta. Se corta aquí y se dice a partir de qué hora sí.
    if (snapped < earliestMin) {
      flash(
        isPastDay
          ? "Ese día ya ha pasado. Elige hoy o un día siguiente."
          : `Esa hora ya ha pasado. El primer hueco es a las ${hhmm(earliestMin)}.`,
      );
      return;
    }
    setDetail(null);
    setBookError(null);
    setDraft({
      clientId: null,
      clientName: null,
      serviceIds: [],
      staffUserId,
      start: localToIso(date, snapped),
    });
  }

  const isToday = date === todayLocalDate();
  const isPastDay = date < todayLocalDate();
  const nowMin = localMinutes(new Date().toISOString());
  // EL SUELO, en la misma aritmética que el motor: el comienzo de la franja
  // en curso. A las 11:10 son las 11:00 — la franja en curso SE RESERVA
  // ("¿tienes hueco ahora?" es media agenda de una peluquería), y por eso
  // la línea de "ahora" cae DENTRO de la última franja que aún se ofrece.
  const floorMin = Math.floor(nowMin / SLOT_MIN) * SLOT_MIN;
  const earliestMin = isPastDay
    ? Number.POSITIVE_INFINITY
    : isToday
      ? floorMin
      : Number.NEGATIVE_INFINITY;
  // Hasta dónde se pinta apagada la columna. `null` = nada del día ha
  // pasado (un día futuro).
  const pastUntilMin = isPastDay ? dayEndMin : isToday ? floorMin : null;

  return (
    <div className="fixed inset-0 z-40 bg-mipiace-stone flex flex-col font-sans">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 md:px-6 h-16 bg-white border-b border-slate-200 shrink-0">
        {/* B-reservas-5 F8 · `shrink-0`. Sin él, a 390 px el flex aplastaba
            el botón de Volver a 20 px de ancho: el área tocable se comía
            para hacerle sitio al título, y el estándar de la casa son
            64×64 (docs/ux-principles.md §1.2). Nada de lo que hay en esta
            barra puede encogerse por debajo de su área tocable. */}
        <button
          onClick={onClose}
          className="h-11 w-11 shrink-0 rounded-2xl hover:bg-slate-100 flex items-center justify-center text-mipiace-ink"
          aria-label="Volver"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2.25} />
        </button>
        {/* El título se va en compacto: la tira de días de debajo ya dice
            que esto es la agenda, y esos 66 px son los que le faltaban al
            botón de Volver y al de Nueva cita. */}
        <h1 className="hidden sm:block text-[18px] font-semibold text-mipiace-ink">
          Agenda
        </h1>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          {/* B-reservas-5 F8 · las flechas se van en compacto. A 320 px la
              barra no cabía y lo que se cortaba era "Nueva cita", que es
              la acción principal. Y son redundantes: la tira de días de
              debajo hace el mismo trabajo y con el dedo. */}
          <button
            onClick={() => setDate(addDays(date, -1))}
            className="hidden sm:flex h-9 w-9 rounded-xl hover:bg-slate-100 items-center justify-center"
            aria-label="Día anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setDate(todayLocalDate())}
            className="h-9 px-3 rounded-xl hover:bg-slate-100 text-[13px] font-medium capitalize"
          >
            {isToday ? "Hoy" : fmtDateHuman(date)}
          </button>
          <button
            onClick={() => setDate(addDays(date, 1))}
            className="hidden sm:flex h-9 w-9 rounded-xl hover:bg-slate-100 items-center justify-center"
            aria-label="Día siguiente"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        {offline && (
          <span className="ml-2 text-[11px] rounded-md bg-amber-100 text-amber-700 px-2 py-0.5">
            Sin conexión · caché
          </span>
        )}
        <div className="flex-1" />
        {/* Filtro por profesional (útil en móvil = "mi día") */}
        {activeStaff.length > 0 && (
          <select
            value={staffFilter ?? ""}
            onChange={(e) => setStaffFilter(e.target.value || null)}
            className="h-10 px-2 shrink-0 rounded-xl bg-mipiace-stone border border-slate-200 text-[13px]"
          >
            <option value="">Todos</option>
            {activeStaff.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.displayName}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() =>
            setDraft({
              clientId: null,
              clientName: null,
              serviceIds: [],
              staffUserId: null,
              start: null,
            })
          }
          className="h-11 px-4 shrink-0 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium flex items-center gap-2"
        >
          <Plus className="w-[18px] h-[18px]" strokeWidth={2.25} />
          <span className="hidden sm:inline">Nueva cita</span>
        </button>
      </div>

      {/* B-reservas-6a frente O · un alta que el servidor rechazó no puede
          quedarse sólo en el chip de abajo a la derecha: la cajera está
          mirando la agenda, y esa cita la escribió ella. El aviso NO es un
          toast — no se va solo — y trae la acción que se quiere: reintentar.
          Descartar sigue en el chip, que ya pide confirmación. */}
      {rechazadas.length > 0 && (
        <div className="shrink-0 px-3 md:px-6 py-2 bg-red-50 border-b border-red-200 flex items-center gap-3 flex-wrap">
          <span className="text-[13px] text-red-800">
            {rechazadas.length === 1
              ? `La cita de las ${localHHMM(rechazadas[0]!.start)} no se pudo guardar`
              : `${rechazadas.length} citas no se pudieron guardar`}
            {rechazadas.length === 1 && rechazadas[0]!.outboxError
              ? `: ${rechazadas[0]!.outboxError}`
              : "."}
          </span>
          <button
            onClick={() => {
              for (const a of rechazadas) void outboxRetry(a.id);
            }}
            className="h-9 shrink-0 px-3 rounded-xl bg-white border border-red-200 hover:bg-red-100 text-[12.5px] font-medium text-red-700"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Semana (tira de días) */}
      <div className="flex gap-1 px-3 md:px-6 py-2 bg-white border-b border-slate-100 shrink-0 overflow-x-auto">
        {Array.from({ length: 7 }, (_, i) => addDays(todayLocalDate(), i)).map(
          (d) => (
            <button
              key={d}
              onClick={() => setDate(d)}
              className={`shrink-0 h-9 px-3 rounded-xl text-[12.5px] font-medium capitalize ${
                d === date
                  ? "bg-mipiace-ink text-white"
                  : "bg-mipiace-stone text-slate-600 hover:bg-slate-200"
              }`}
            >
              {new Intl.DateTimeFormat("es-ES", {
                weekday: "short",
                day: "numeric",
              }).format(new Date(`${d}T12:00:00.000Z`))}
            </button>
          ),
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Calendario */}
        <div ref={scrollRef} className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center gap-2 text-[13px] text-slate-500 py-10 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
            </div>
          ) : columns.length === 0 ? (
            <div className="p-8 text-center text-[14px] text-slate-500 max-w-md mx-auto">
              No hay profesionales con perfil de agenda activo. Actívalos en el
              panel de Personal (admin).
            </div>
          ) : (
            <div className="flex min-w-max">
              {/* Regla de horas.

                  B-reservas-6a · la regla MENTÍA, y el bucle visual de este
                  bloque la pilló. Dos fallos, los dos preexistentes (se ven
                  igual en las capturas de B-5):

                  1. no dejaba hueco para la cabecera de profesional, así que
                     iba 40 px por delante de las columnas;
                  2. cada fila llevaba `-mt-2` en flujo, y esos 8 px se
                     ACUMULABAN: la regla derivaba 8 px por hora. A las 20:00
                     eran 96 px — hora y media de desfase.

                  Ahora las etiquetas van absolutas sobre la misma geometría
                  que las líneas de la columna, centradas en su hora. Con el
                  suelo pintado esto deja de ser un detalle: si la regla no
                  cuadra, no se sabe a qué hora acaba lo que ya pasó. */}
              <div className="w-14 shrink-0 sticky left-0 z-10 bg-mipiace-stone">
                <div className="h-10 shrink-0" />
                <div
                  className="relative"
                  style={{ height: (dayEndMin - dayStartMin) * PX_PER_MIN }}
                >
                  {hourRows().map((h) => (
                    <div
                      key={h}
                      data-hora={`${String(h).padStart(2, "0")}:00`}
                      style={{ top: (h * 60 - dayStartMin) * PX_PER_MIN }}
                      className="absolute right-0 pr-2 -translate-y-1/2 text-[11px] text-slate-400 tabular-nums"
                    >
                      {String(h).padStart(2, "0")}:00
                    </div>
                  ))}
                </div>
              </div>
              {/* Columnas por profesional */}
              {columns.map((s) => (
                <StaffColumn
                  key={s.userId}
                  staff={s}
                  appts={apptsByStaff.get(s.userId) ?? []}
                  nowMin={isToday ? nowMin : null}
                  pastUntilMin={pastUntilMin}
                  onSlot={(min) => openSlotFirst(s.userId, min)}
                  onAppt={abrirCita}
                  labelOf={serviceNames}
                  clientOf={(a) => clientName(a.clientId)}
                />
              ))}
              {(apptsByStaff.get("__unassigned__")?.length ?? 0) > 0 && (
                <StaffColumn
                  staff={{
                    userId: "__unassigned__",
                    displayName: "Sin asignar",
                    color: "#94a3b8",
                    active: true,
                  }}
                  appts={apptsByStaff.get("__unassigned__") ?? []}
                  nowMin={isToday ? nowMin : null}
                  pastUntilMin={pastUntilMin}
                  onSlot={(min) => openSlotFirst(null, min)}
                  onAppt={abrirCita}
                  labelOf={serviceNames}
                  clientOf={(a) => clientName(a.clientId)}
                />
              )}
            </div>
          )}
        </div>

        {/* Panel de alta — AL LADO, sin scrim (no tapa el calendario). En
            móvil ocupa toda la anchura como hoja. */}
        {draft && (
          <BookingPanel
            draft={draft}
            setDraft={setDraft}
            services={services}
            staff={activeStaff}
            date={date}
            isPastDay={isPastDay}
            bookError={bookError}
            onPickAlternative={(start) => {
              setDraft({ ...draft, start });
              setBookError(null);
            }}
            onCancel={() => {
              setDraft(null);
              setBookError(null);
            }}
            onReserve={() => doCreate(false)}
            onReserveAndCharge={() => doCreate(true)}
          />
        )}
        {/* Detalle de cita */}
        {detail && (
          <DetailPanel
            appt={detail}
            clientName={clientName(detail.clientId)}
            serviceLabel={serviceNames(detail)}
            onClose={() => setDetail(null)}
            onStatus={(st) => changeStatus(detail.id, st)}
            onCheckout={() => doCheckout(detail.id)}
          />
        )}
      </div>

      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-mipiace-ink text-white text-[13px] px-4 py-2 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

function hourRows(): number[] {
  const out: number[] = [];
  for (let h = dayStartMin / 60; h < dayEndMin / 60; h++) out.push(h);
  return out;
}

// ── Columna de un profesional ──────────────────────────────────────────

function StaffColumn(props: {
  staff: AgendaStaff;
  appts: AgendaAppointment[];
  nowMin: number | null;
  // B-reservas-6a · hasta qué minuto del día ya ha pasado (el suelo).
  // `null` = un día futuro, nada ha pasado.
  pastUntilMin: number | null;
  onSlot: (minutes: number) => void;
  onAppt: (a: AgendaAppointment) => void;
  labelOf: (a: AgendaAppointment) => string;
  clientOf: (a: AgendaAppointment) => string;
}) {
  const { staff, appts, nowMin, pastUntilMin } = props;
  const totalH = (dayEndMin - dayStartMin) * PX_PER_MIN;
  const pastH =
    pastUntilMin == null
      ? 0
      : Math.max(
          0,
          (Math.min(pastUntilMin, dayEndMin) - dayStartMin) * PX_PER_MIN,
        );
  return (
    <div className="w-44 md:w-52 shrink-0 border-l border-slate-200">
      <div
        className="sticky top-0 z-10 h-10 flex items-center gap-2 px-2 bg-white border-b border-slate-200"
        style={{ borderTop: `3px solid ${staff.color ?? "#cbd5e1"}` }}
      >
        <span className="text-[13px] font-semibold text-mipiace-ink truncate">
          {staff.displayName}
        </span>
      </div>
      <div
        // Gancho estable para el bucle visual y el test de jsdom: la
        // superficie de la columna hay que poder tocarla por su sitio.
        data-columna={staff.userId}
        className="relative"
        style={{ height: totalH }}
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const y = e.clientY - rect.top;
          props.onSlot(dayStartMin + y / PX_PER_MIN);
        }}
      >
        {/* B-reservas-6a · lo que ya pasó no invita. Va PRIMERO en el DOM
            para quedar por debajo de las citas (una cita de las 10:00 se
            sigue viendo y se sigue tocando: se cobra, se finaliza y se
            cancela). El borde de abajo es el SUELO, no "ahora": la línea
            roja cae dentro de la franja en curso, que sí se reserva. */}
        {pastH > 0 && (
          <div
            aria-hidden
            style={{ height: pastH }}
            className="absolute left-0 right-0 top-0 bg-slate-200/45 pointer-events-none border-b border-slate-300/60"
          />
        )}
        {/* rejilla horaria */}
        {hourRows().map((h) => (
          <div
            key={h}
            style={{ top: (h * 60 - dayStartMin) * PX_PER_MIN }}
            className="absolute left-0 right-0 border-t border-slate-100"
          />
        ))}
        {/* línea "ahora" */}
        {nowMin != null && nowMin >= dayStartMin && nowMin <= dayEndMin && (
          <div
            style={{ top: (nowMin - dayStartMin) * PX_PER_MIN }}
            className="absolute left-0 right-0 h-0.5 bg-red-500 z-20"
          />
        )}
        {/* citas */}
        {appts.map((a) => {
          const top = (localMinutes(a.start) - dayStartMin) * PX_PER_MIN;
          const height = Math.max(
            22,
            (localMinutes(a.end) - localMinutes(a.start)) * PX_PER_MIN,
          );
          // B-reservas-6a frente O · una cita que sigue en el outbox se
          // pinta DISTINTA: a rayas discontinuas y diciendo en qué estado
          // está. No es una cita del centro todavía — y si el servidor la
          // rechazó, se queda ahí en rojo hasta que alguien decida.
          const local = a.pendingOffline === true;
          const rechazada = a.outboxStatus === "rejected";
          return (
            <button
              key={a.id + staff.userId}
              onClick={(e) => {
                e.stopPropagation();
                props.onAppt(a);
              }}
              style={{
                top,
                height,
                ...(local
                  ? {}
                  : { borderLeft: `4px solid ${STATUS_COLOR[a.status]}` }),
              }}
              className={
                local
                  ? `absolute left-1 right-1 rounded-lg px-2 py-1 text-left overflow-hidden border-2 border-dashed ${
                      rechazada
                        ? "bg-red-50 border-red-300"
                        : "bg-amber-50 border-amber-300"
                    }`
                  : "absolute left-1 right-1 rounded-lg bg-white shadow-sm border border-slate-200 px-2 py-1 text-left overflow-hidden hover:shadow-md"
              }
            >
              <div
                className={`text-[11px] font-semibold truncate ${
                  local
                    ? rechazada
                      ? "text-red-800"
                      : "text-amber-900"
                    : "text-mipiace-ink"
                }`}
              >
                {localHHMM(a.start)} · {props.clientOf(a)}
                {local && (rechazada ? " · rechazada" : " · sin enviar")}
              </div>
              {/* B-reservas-5 F8 · la segunda línea sólo si cabe entera.
                  Una cita de 30 min mide 33 px y el contenido pide 40:
                  el `overflow-hidden` cortaba "Corte de pelo" por la
                  mitad de las letras, que se lee como un fallo de pintado.
                  Cortar limpio y dejar el servicio para el detalle es
                  mejor que enseñar media palabra. */}
              {height >= CARD_TWO_LINE_MIN_H && (
                <div className="text-[10.5px] text-slate-500 truncate">
                  {props.labelOf(a)}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Panel de alta (cliente-first + multi-servicio + buscar hueco) ──────

function BookingPanel(props: {
  draft: DraftBooking;
  setDraft: (d: DraftBooking) => void;
  services: CatalogProduct[];
  staff: AgendaStaff[];
  date: string;
  // B-reservas-6a · un día que ya pasó no tiene huecos que buscar.
  isPastDay: boolean;
  // El 409 del servidor con su frase y sus alternativas.
  bookError: { message: string; alternatives: AvailabilitySlot[] } | null;
  onPickAlternative: (start: string) => void;
  onCancel: () => void;
  onReserve: () => void;
  onReserveAndCharge: () => void;
}) {
  const { draft, setDraft, services, date, isPastDay, bookError } = props;
  const picker = useClientPicker();
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // El panel hace scroll: si el aviso nace fuera de la vista, no existe.
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // `?.()` porque jsdom no implementa scrollIntoView y el aviso no
    // puede depender de que exista.
    if (bookError) errorRef.current?.scrollIntoView?.({ block: "center" });
  }, [bookError]);

  const bookableServices = services.filter(
    (s) => s.kind === "SERVICE" && (s.durationMin ?? 0) > 0,
  );
  const totalDuration = draft.serviceIds.reduce((sum, id) => {
    const s = services.find((x) => x.id === id);
    return sum + (s?.durationMin ?? 0);
  }, 0);

  const endHHMM = draft.start
    ? localHHMM(
        new Date(
          new Date(draft.start).getTime() + totalDuration * 60000,
        ).toISOString(),
      )
    : null;

  function toggleService(id: string) {
    const has = draft.serviceIds.includes(id);
    setDraft({
      ...draft,
      serviceIds: has
        ? draft.serviceIds.filter((x) => x !== id)
        : [...draft.serviceIds, id],
    });
    setSlots([]);
  }

  async function findSlots() {
    if (draft.serviceIds.length === 0) return;
    if (isPastDay) {
      setSearchError("Ese día ya ha pasado.");
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const res = await searchAvailability({
        items: draft.serviceIds.map((serviceId) => ({ serviceId })),
        staffUserId: draft.staffUserId,
        from: date,
        to: date,
      });
      setSlots(res);
      if (res.length === 0) setSearchError("No hay huecos ese día.");
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : "Error buscando huecos.");
    } finally {
      setSearching(false);
    }
  }

  const canReserve = draft.serviceIds.length > 0 && !!draft.start;

  return (
    <div className="w-full md:w-96 shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 h-14 px-4 border-b border-slate-100 shrink-0">
        <h2 className="text-[15px] font-semibold text-mipiace-ink flex-1">
          Nueva cita
        </h2>
        <button
          onClick={props.onCancel}
          className="h-9 w-9 rounded-xl hover:bg-slate-100 flex items-center justify-center"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* B-reservas-6a · el cuerpo es lo único que hace scroll. Antes
          scrolleaba el panel entero con el pie en `sticky bottom-0`, así que
          el pie FLOTABA sobre el contenido: el bucle visual pilló las
          alternativas del 409 asomando por debajo de "Reservar y cobrar",
          visibles y no tocables. */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Cliente primero */}
        <div>
          <label className="text-[12px] font-medium text-slate-500">Cliente</label>
          <button
            onClick={() =>
              picker.open((c) =>
                setDraft({ ...draft, clientId: c.id, clientName: clientFullName(c) }),
              )
            }
            className="mt-1 w-full h-11 px-3 rounded-xl bg-mipiace-stone border border-slate-200 text-left text-[14px]"
          >
            {draft.clientName ?? "Buscar o crear cliente…"}
          </button>
        </div>

        {/* Servicios encadenables */}
        <div>
          <label className="text-[12px] font-medium text-slate-500">
            Servicios {totalDuration > 0 && `· ${totalDuration} min`}
            {endHHMM && ` · fin ${endHHMM}`}
          </label>
          <div className="mt-1 space-y-1 max-h-52 overflow-y-auto">
            {bookableServices.length === 0 && (
              <div className="text-[12px] text-slate-400 py-2">
                No hay servicios con duración configurada.
              </div>
            )}
            {bookableServices.map((s) => {
              const active = draft.serviceIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleService(s.id)}
                  className={`w-full flex items-center justify-between px-3 h-10 rounded-lg border text-[13px] ${
                    active
                      ? "border-mipiace-coral bg-mipiace-coral/10 text-mipiace-ink"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  <span className="truncate">{s.name}</span>
                  <span className="text-[11px] tabular-nums text-slate-400">
                    {s.durationMin} min
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Hueco: fijado (slot-first) o buscar */}
        <div>
          <label className="text-[12px] font-medium text-slate-500">Hora</label>
          {draft.start ? (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[14px] font-semibold text-mipiace-ink">
                {localHHMM(draft.start)}
              </span>
              <button
                onClick={() => setDraft({ ...draft, start: null })}
                className="text-[12px] text-mipiace-coral"
              >
                cambiar
              </button>
            </div>
          ) : (
            <div className="mt-1">
              <button
                onClick={findSlots}
                disabled={draft.serviceIds.length === 0 || searching || isPastDay}
                className="w-full h-10 rounded-xl bg-mipiace-ink text-white text-[13px] font-medium disabled:opacity-40"
              >
                {searching ? "Buscando…" : "Buscar hueco"}
              </button>
              {searchError && (
                <div className="text-[12px] text-red-500 mt-1">{searchError}</div>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {slots.slice(0, 24).map((sl) => (
                  <button
                    key={sl.start}
                    onClick={() => setDraft({ ...draft, start: sl.start })}
                    className="h-9 px-2.5 rounded-lg bg-mipiace-stone hover:bg-slate-200 text-[12.5px] tabular-nums"
                  >
                    {localHHMM(sl.start)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* B-reservas-6a · el 409 del suelo, pegado a la HORA, que es de lo
            que habla. Aquí y no al final del panel: el bucle visual lo puso
            debajo de las acciones primarias y la barra pegajosa le tapaba
            justo las alternativas — un error con salida cuya salida no se
            puede tocar es medio error otra vez. */}
        {bookError && (
          <div
            ref={errorRef}
            className="rounded-xl border border-amber-300 bg-amber-50 p-3"
          >
            <div className="text-[13px] leading-snug text-amber-900">
              {bookError.message}
            </div>
            {bookError.alternatives.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {bookError.alternatives.slice(0, 3).map((sl) => (
                  <button
                    key={sl.start}
                    onClick={() => props.onPickAlternative(sl.start)}
                    className="h-11 px-3.5 rounded-xl bg-white border border-amber-300 text-[14px] font-semibold tabular-nums text-amber-900 hover:bg-amber-100"
                  >
                    {localHHMM(sl.start)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Acciones primarias */}
      <div className="shrink-0 p-4 border-t border-slate-100 space-y-2 bg-white">
        <button
          onClick={props.onReserveAndCharge}
          disabled={!canReserve}
          className="w-full h-12 rounded-xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[15px] font-semibold disabled:opacity-40"
        >
          Reservar y cobrar
        </button>
        <button
          onClick={props.onReserve}
          disabled={!canReserve}
          className="w-full h-11 rounded-xl border border-slate-300 text-mipiace-ink text-[14px] font-medium disabled:opacity-40"
        >
          Reservar
        </button>
      </div>
      {picker.element}
    </div>
  );
}

// ── Detalle de cita ────────────────────────────────────────────────────

function DetailPanel(props: {
  appt: AgendaAppointment;
  clientName: string;
  serviceLabel: string;
  onClose: () => void;
  onStatus: (s: AppointmentStatus) => void;
  onCheckout: () => void;
}) {
  const { appt } = props;
  const terminal =
    appt.status === "COMPLETED" ||
    appt.status === "CANCELLED" ||
    appt.status === "NO_SHOW";
  return (
    <div className="w-full md:w-80 shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-y-auto">
      <div className="flex items-center gap-2 h-14 px-4 border-b border-slate-100 shrink-0">
        <h2 className="text-[15px] font-semibold text-mipiace-ink flex-1">
          Detalle
        </h2>
        <button
          onClick={props.onClose}
          className="h-9 w-9 rounded-xl hover:bg-slate-100 flex items-center justify-center"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-4 space-y-3 text-[14px]">
        <div>
          <div className="text-[12px] text-slate-400">Cliente</div>
          <div className="font-medium text-mipiace-ink">{props.clientName}</div>
        </div>
        <div>
          <div className="text-[12px] text-slate-400">Servicios</div>
          <div className="text-mipiace-ink">{props.serviceLabel}</div>
        </div>
        <div>
          <div className="text-[12px] text-slate-400">Hora</div>
          <div className="tabular-nums text-mipiace-ink">
            {localHHMM(appt.start)} – {localHHMM(appt.end)}
          </div>
        </div>
        <div>
          <span
            className="inline-block text-[12px] font-medium px-2 py-0.5 rounded-md text-white"
            style={{ background: STATUS_COLOR[appt.status] }}
          >
            {STATUS_LABEL[appt.status]}
          </span>
        </div>
      </div>

      {!terminal && (
        <div className="p-4 border-t border-slate-100 space-y-2">
          <button
            onClick={props.onCheckout}
            className="w-full h-12 rounded-xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[15px] font-semibold"
          >
            Cobrar en caja
          </button>
          <div className="grid grid-cols-2 gap-2">
            {appt.status === "PENDING" && (
              <StatusBtn label="Confirmar" onClick={() => props.onStatus("CONFIRMED")} />
            )}
            {appt.status !== "IN_SERVICE" && (
              <StatusBtn label="En sala" onClick={() => props.onStatus("IN_SERVICE")} />
            )}
            <StatusBtn label="Finalizar" onClick={() => props.onStatus("COMPLETED")} />
            <StatusBtn label="No-show" onClick={() => props.onStatus("NO_SHOW")} />
            <StatusBtn
              label="Cancelar"
              danger
              onClick={() => props.onStatus("CANCELLED")}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBtn(props: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      className={`h-10 rounded-xl border text-[13px] font-medium ${
        props.danger
          ? "border-red-200 text-red-600 hover:bg-red-50"
          : "border-slate-300 text-mipiace-ink hover:bg-slate-50"
      }`}
    >
      {props.label}
    </button>
  );
}
