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
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreVertical,
  Plus,
  Stethoscope,
  X,
} from "lucide-react";

import { ApiError } from "../api.js";
import { loadCatalogFromCache, type CatalogProduct } from "../lib/catalog.js";
import {
  clientFullName,
  loadClientsFromCache,
  type ClientRow,
} from "../lib/clients.js";
import {
  ALL_DAY_END,
  ALL_DAY_START,
  centerHHMM,
  centerToday,
  centerWallDate,
  checkoutAppointmentTicket,
  createAbsence,
  createAppointment,
  dayInfoOf,
  deleteAbsence,
  fetchAgendaDay,
  loadAgendaDayFromCache,
  patchAppointment,
  searchAvailability,
  slotMinutesOf,
  STATUS_COLOR,
  STATUS_LABEL,
  type AgendaAbsence,
  type AgendaAppointment,
  type AgendaDay,
  type AgendaDayInfo,
  type AgendaStaff,
  type AppointmentStatus,
  type AvailabilitySlot,
  type OpenRange,
} from "../lib/agenda.js";
import {
  colorDeProfesional,
  tinteDeProfesional,
  tonoDeEstado,
} from "../lib/staffColor.js";
import { useClientPicker } from "../hooks/useClientPicker.js";
import { outboxRetry, subscribeOutbox } from "../lib/outbox.js";
import {
  fetchAgendaHealth,
  readHealthSnapshot,
  serviciosSinNadie,
} from "../lib/agenda-health.js";
import { AgendaHealthPanel } from "./AgendaHealthPanel.js";
import { AgendaSkillMatrix } from "./AgendaSkillMatrix.js";

// ── Helpers de zona horaria (Europe/Madrid) para pintar ────────────────

const TZ = "Europe/Madrid";
// B-reservas-7a · `SLOT_MIN` YA NO EXISTE. La retícula del centro es un
// dato del día (`Tenant.agendaSlotMinutes`, 15 o 30) que llega con
// `GET /agenda` y viaja en la caché offline: el toque, las líneas de la
// regla y el suelo pintado salen de ahí. Sole trabaja en franjas de 30 y
// hasta este bloque le ofrecíamos inicios a y cuarto (6a §4.6).
//
// El suelo de 6a no cambia: sigue siendo el comienzo de la franja EN
// CURSO. Con 30 eso significa que a las 11:29 todavía valen las 11:00.

// La franja visible del día sale del horario del centro con este margen;
// 08:00–21:00 queda sólo como valor por defecto de un centro SIN
// configurar, que es como se comportaba antes del bloque.
const DEFAULT_START_MIN = 8 * 60;
const DEFAULT_END_MIN = 21 * 60;
const VISIBLE_MARGIN_MIN = 30;
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

// "HH:MM" → minutos desde medianoche. "24:00" son 1440: es el final del
// día, no las 00:00 del mismo (una ausencia de día entero acaba ahí).
function minOf(time: string): number {
  const [hh, mm] = time.split(":").map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}

// ── B-reservas-7a · la geometría del día ──────────────────────────────

/**
 * De qué hora a qué hora se pinta el día.
 *
 * Sale del horario del CENTRO de ese día con media hora de margen arriba y
 * abajo, redondeado a la hora. Un sábado de boda que abre a las 8:30
 * enseña las 8:30; 08:00–21:00 queda como valor por defecto de un centro
 * sin configurar.
 *
 * Y SIEMPRE se ensancha hasta cubrir toda cita y toda ausencia del día: una
 * cita que quedó fuera de horario —porque el festivo o la ausencia se
 * pusieron después— tiene que seguir viéndose y pudiéndose cobrar. Si la
 * franja visible no la cubriera, sería una cita impintable.
 */
function visibleRange(
  info: AgendaDayInfo | undefined,
  appts: AgendaAppointment[],
): { startMin: number; endMin: number } {
  let start = DEFAULT_START_MIN;
  let end = DEFAULT_END_MIN;
  if (info?.open && info.open.length > 0) {
    start = Math.min(...info.open.map((r) => minOf(r.startTime)));
    end = Math.max(...info.open.map((r) => minOf(r.endTime)));
    start = Math.floor((start - VISIBLE_MARGIN_MIN) / 60) * 60;
    end = Math.ceil((end + VISIBLE_MARGIN_MIN) / 60) * 60;
  }
  for (const a of appts) {
    if (a.status === "CANCELLED") continue;
    const s = localMinutes(a.start);
    // Una cita que acaba a medianoche da 0: es el final del día, no el
    // principio.
    const e0 = localMinutes(a.end);
    const e = e0 <= s ? 24 * 60 : e0;
    start = Math.min(start, Math.floor(s / 60) * 60);
    end = Math.max(end, Math.ceil(e / 60) * 60);
  }
  for (const ab of info?.absences ?? []) {
    start = Math.min(start, Math.floor(minOf(ab.startTime) / 60) * 60);
    end = Math.max(end, Math.ceil(minOf(ab.endTime) / 60) * 60);
  }
  start = Math.max(0, start);
  end = Math.min(24 * 60, Math.max(end, start + 60));
  return { startMin: start, endMin: end };
}

/**
 * Los huecos NO reservables de una columna dentro de la franja visible: lo
 * que cae fuera de sus tramos abiertos.
 *
 * `open === null` (centro sin configurar) devuelve CERO bandas: sin techo
 * no hay nada que apagar, que es como se comportaba antes del bloque.
 */
function closedBands(
  open: OpenRange[] | null | undefined,
  startMin: number,
  endMin: number,
): Array<{ from: number; to: number }> {
  if (open == null) return [];
  const abiertos = [...open]
    .map((r) => ({ from: minOf(r.startTime), to: minOf(r.endTime) }))
    .sort((a, b) => a.from - b.from);
  const out: Array<{ from: number; to: number }> = [];
  let cursor = startMin;
  for (const r of abiertos) {
    if (r.from > cursor) out.push({ from: cursor, to: Math.min(r.from, endMin) });
    cursor = Math.max(cursor, r.to);
  }
  if (cursor < endMin) out.push({ from: cursor, to: endMin });
  return out.filter((b) => b.to > b.from);
}

/** ¿Este minuto cae dentro de algún tramo abierto? Sin techo, siempre sí. */
function isOpenAt(open: OpenRange[] | null | undefined, minute: number): boolean {
  if (open == null) return true;
  return open.some((r) => minOf(r.startTime) <= minute && minute < minOf(r.endTime));
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
  // B-reservas-9 · el panel de salud y la matriz cuelgan de aquí: se entra y
  // se sale sin dejar la agenda.
  const [saludAbierta, setSaludAbierta] = useState(false);
  const [matriz, setMatriz] = useState<{ focusServiceId: string | null } | null>(
    null,
  );
  // La cifra de la tarjeta nº 1 en el botón. Un panel que hay que abrir para
  // enterarse de que hay un problema es el mismo silencio de antes con otra
  // pantalla: el número tiene que verse desde la agenda.
  const [sinNadie, setSinNadie] = useState<number | null>(
    () => serviciosSinNadie(readHealthSnapshot()?.health ?? null),
  );
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
  // B-reservas-7a · la hoja de ausencias, que es donde Sole las escribe hoy
  // (en la columna, no en el admin). `null` = cerrada.
  const [absenceFor, setAbsenceFor] = useState<AgendaStaff | null>(null);
  // La ausencia pintada que se ha tocado, para ofrecer quitarla.
  const [absenceDetail, setAbsenceDetail] = useState<AgendaAbsence | null>(null);
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

  // ── B-reservas-7a · la geometría del día ──────────────────────────
  //
  // Tres datos que antes eran constantes del módulo y ahora salen del día:
  // la retícula del centro, y de qué hora a qué hora se pinta. Sin red
  // salen de la caché; sin caché, de los valores por defecto de B4.
  const dayInfo = useMemo(() => dayInfoOf(day, date), [day, date]);
  const slotMin = slotMinutesOf(day);
  const { startMin: dayStartMin, endMin: dayEndMin } = useMemo(
    () => visibleRange(dayInfo, day?.appointments ?? []),
    [dayInfo, day],
  );
  // El día cerrado: la rejilla no ofrece nada y lo dice con su nombre.
  const cerrado = dayInfo?.closed ?? null;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, day, dayStartMin]);

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

  // Las ausencias que van en cada columna. Las del CENTRO (sin dueño) se
  // pintan en todas: un cierre por formación afecta a quien esté.
  const absencesByStaff = useMemo(() => {
    const m = new Map<string, AgendaAbsence[]>();
    for (const s of activeStaff) {
      m.set(
        s.userId,
        (dayInfo?.absences ?? []).filter(
          (a) => a.staffUserId === s.userId || a.staffUserId === null,
        ),
      );
    }
    return m;
  }, [dayInfo, activeStaff]);

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

  // B-reservas-7a · una ausencia es un `BookingBlock scope=STAFF` por la
  // API que ya existe. No se crea ninguna entidad nueva.
  async function ponerAusencia(
    staff: AgendaStaff,
    startTime: string,
    endTime: string,
    reason: string,
  ) {
    const res = await createAbsence({
      staffUserId: staff.userId,
      date,
      startTime,
      endTime,
      reason,
    });
    setAbsenceFor(null);
    if (!res.ok) {
      flash(res.message);
      return;
    }
    flash(
      startTime === ALL_DAY_START && endTime === ALL_DAY_END
        ? `${staff.displayName} no está hoy.`
        : `${staff.displayName} no está de ${startTime} a ${endTime}.`,
    );
    await loadDay(date);
  }

  async function quitarAusencia(a: AgendaAbsence) {
    setAbsenceDetail(null);
    if (!a.id) {
      flash("Esa ausencia no se puede quitar desde aquí.");
      return;
    }
    const res = await deleteAbsence(a.id);
    if (!res.ok) {
      flash(res.message);
      return;
    }
    flash("Ausencia quitada.");
    await loadDay(date);
  }

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
    // B-reservas-7a · se redondea HACIA ABAJO, no al más cercano. Con la
    // retícula pintada (sobre todo a 30) redondear al más cercano
    // contradice lo que se ve: la mitad de abajo de la banda de las 11:00
    // abriría un alta a las 11:30. Se toca una banda, se coge esa banda.
    const snapped = Math.floor(minutes / slotMin) * slotMin;

    // B-reservas-7a · el día cerrado no ofrece NADA, y lo dice con su
    // nombre. Tocarlo para acabar en un 409 es pasear a la cajera delante
    // de la clienta.
    if (cerrado) {
      flash(
        cerrado.name
          ? `El centro está cerrado ese día · ${cerrado.name}.`
          : "El centro está cerrado ese día.",
      );
      return;
    }
    // Fuera de los tramos abiertos de ESA columna tampoco se abre un alta:
    // o el centro no abre a esa hora, o esa profesional no está.
    const abiertos = staffUserId
      ? (dayInfo?.staffOpen?.[staffUserId] ?? null)
      : (dayInfo?.open ?? null);
    if (dayInfo && !isOpenAt(abiertos, snapped)) {
      flash(
        abiertos && abiertos.length > 0
          ? `A esa hora no se reserva. El horario es ${abiertos
              .map((r) => `${r.startTime}–${r.endTime}`)
              .join(" y ")}.`
          : "A esa hora no se reserva: ese día no hay turno en esta columna.",
      );
      return;
    }
    // Y una ausencia pintada es la tercera causa, con su motivo.
    const ausencia = (dayInfo?.absences ?? []).find(
      (a) =>
        (a.staffUserId === staffUserId || a.staffUserId === null) &&
        minOf(a.startTime) <= snapped &&
        snapped < minOf(a.endTime),
    );
    if (ausencia) {
      flash(
        ausencia.reason
          ? `A esa hora no está: ${ausencia.reason}.`
          : "A esa hora no está.",
      );
      return;
    }

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
  //
  // B-reservas-7a · con la retícula de 30 la franja es el DOBLE de grande:
  // a las 11:29 todavía se pueden dar las 11:00, a las 11:30 ya no. Mismo
  // precio, decisión del bloque.
  const floorMin = Math.floor(nowMin / slotMin) * slotMin;
  const earliestMin = isPastDay
    ? Number.POSITIVE_INFINITY
    : isToday
      ? floorMin
      : Number.NEGATIVE_INFINITY;
  // Hasta dónde se pinta apagada la columna. `null` = nada del día ha
  // pasado (un día futuro).
  const pastUntilMin = isPastDay ? dayEndMin : isToday ? floorMin : null;

  // B-reservas-9 · una sola lectura al abrir la agenda. Si no hay red no
  // pasa nada: el botón se queda con la cifra de la última foto, o sin
  // cifra. Nunca con un cero inventado.
  useEffect(() => {
    let cancelado = false;
    void fetchAgendaHealth()
      .then((snap) => {
        if (!cancelado) setSinNadie(serviciosSinNadie(snap.health));
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);

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

      {/* Semana (tira de días) + la puerta del panel de salud.
          B-reservas-9 · el botón NO va en la cabecera: a 320 px la barra ya
          iba justa y lo que se cortaba era "Nueva cita" (B-5 F8). Aquí no
          le quita nada a nadie — los chips de día ya hacen scroll — y la
          cifra de servicios que nadie puede hacer se ve desde la agenda,
          que es de lo que va el bloque: el fallo era invisible porque había
          que saber dónde mirar. */}
      <div className="flex items-center gap-1 px-3 md:px-6 py-2 bg-white border-b border-slate-100 shrink-0">
        <div className="flex-1 flex gap-1 overflow-x-auto">
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
        <button
          onClick={() => setSaludAbierta(true)}
          className={`ml-1 h-11 px-3 shrink-0 rounded-2xl text-[13px] font-medium flex items-center gap-1.5 ${
            sinNadie !== null && sinNadie > 0
              ? "bg-mipiace-coral-soft text-mipiace-coral-dark"
              : "bg-mipiace-stone text-slate-600 hover:bg-slate-200"
          }`}
          aria-label="Salud de la agenda"
        >
          <Stethoscope className="w-[18px] h-[18px]" strokeWidth={2.25} />
          {sinNadie !== null && sinNadie > 0 && (
            <span data-test="badge-salud" className="tabular-nums font-semibold">
              {sinNadie}
            </span>
          )}
        </button>
      </div>

      {/* B-reservas-7a · el día CERRADO se dice arriba y con su nombre, no
          se deduce de una rejilla vacía. «Cerrado · Virgen del Prado» es lo
          que la cajera le lee a la clienta por teléfono. */}
      {cerrado && (
        <div
          data-dia-cerrado={cerrado.name ?? ""}
          className="shrink-0 px-3 md:px-6 py-2 bg-slate-800 text-white flex items-center gap-2 flex-wrap"
        >
          <span className="text-[13.5px] font-semibold">
            Cerrado{cerrado.name ? ` · ${cerrado.name}` : ""}
          </span>
          <span className="text-[12.5px] text-slate-300">
            Ese día el centro no abre y la agenda no ofrece nada.
          </span>
        </div>
      )}
      {/* Y el día especial que ABRE también se dice: un sábado de boda que
          empieza a las 8:30 no se explica solo. */}
      {!cerrado && dayInfo?.specialName && (
        <div
          data-dia-especial={dayInfo.specialName}
          className="shrink-0 px-3 md:px-6 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2 flex-wrap"
        >
          <span className="text-[13px] font-semibold text-amber-900">
            {dayInfo.specialName}
          </span>
          <span className="text-[12.5px] text-amber-700">
            Horario especial:{" "}
            {(dayInfo.open ?? [])
              .map((r) => `${r.startTime}–${r.endTime}`)
              .join(" y ")}
          </span>
        </div>
      )}

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
                  {hourRows(dayStartMin, dayEndMin).map((h) => (
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
                  dayStartMin={dayStartMin}
                  dayEndMin={dayEndMin}
                  slotMin={slotMin}
                  // El día cerrado apaga la columna entera: `open: []`.
                  open={cerrado ? [] : (dayInfo?.staffOpen?.[s.userId] ?? null)}
                  absences={absencesByStaff.get(s.userId) ?? []}
                  onAbsence={setAbsenceDetail}
                  onMenu={() => setAbsenceFor(s)}
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
                  dayStartMin={dayStartMin}
                  dayEndMin={dayEndMin}
                  slotMin={slotMin}
                  open={cerrado ? [] : (dayInfo?.open ?? null)}
                  absences={(dayInfo?.absences ?? []).filter(
                    (a) => a.staffUserId === null,
                  )}
                  onAbsence={setAbsenceDetail}
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
            dayInfo={dayInfo}
            staffName={
              activeStaff.find((s) => s.userId === draft.staffUserId)
                ?.displayName ?? null
            }
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

      {/* B-reservas-7a · el alta de una ausencia, en TRES TOQUES como
          máximo: el ⋯ de la columna, "No está en todo el día", y ya. */}
      {absenceFor && (
        <AbsenceSheet
          staff={absenceFor}
          // El rango por defecto arranca donde abre su columna, para que
          // "de tal a tal hora" no obligue a tocar los dos selectores.
          openRanges={dayInfo?.staffOpen?.[absenceFor.userId] ?? null}
          slotMin={slotMin}
          onCancel={() => setAbsenceFor(null)}
          onSave={(from, to, reason) =>
            void ponerAusencia(absenceFor, from, to, reason)
          }
        />
      )}
      {/* Y se quita desde la propia ausencia pintada. */}
      {absenceDetail && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 p-3">
          <div className="w-full md:w-80 bg-white rounded-2xl p-4 shadow-xl">
            <h2 className="text-[15px] font-semibold text-mipiace-ink mb-1">
              {absenceDetail.reason ?? "No está"}
            </h2>
            <p className="text-[13px] text-slate-500 mb-4">
              {absenceDetail.startTime === "00:00" &&
              absenceDetail.endTime === "24:00"
                ? "Todo el día"
                : `De ${absenceDetail.startTime} a ${absenceDetail.endTime}`}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setAbsenceDetail(null)}
                className="flex-1 h-11 rounded-2xl bg-mipiace-stone text-[14px] font-medium"
              >
                Cerrar
              </button>
              <button
                onClick={() => void quitarAusencia(absenceDetail)}
                className="flex-1 h-11 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium"
              >
                Quitar
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-mipiace-ink text-white text-[13px] px-4 py-2 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}

      {/* B-reservas-9 · el panel de salud y la matriz. Van encima de la
          agenda y se cierran a ella: el criterio del bloque es que el fallo
          se arregle SIN salir de la agenda. */}
      {saludAbierta && (
        <AgendaHealthPanel
          onClose={() => setSaludAbierta(false)}
          onOpenMatrix={(focusServiceId) => setMatriz({ focusServiceId })}
        />
      )}
      {matriz && (
        <AgendaSkillMatrix
          focusServiceId={matriz.focusServiceId}
          onClose={() => {
            setMatriz(null);
            // Al volver de arreglar la matriz, la cifra del botón se relee:
            // si ya no hay servicios huérfanos, el aviso se va solo.
            void fetchAgendaHealth()
              .then((snap) => setSinNadie(serviciosSinNadie(snap.health)))
              .catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}

// B-reservas-7a · la regla ya no es de 8 a 21: sale de la franja visible
// del día, que sale del horario del centro.
function hourRows(startMin: number, endMin: number): number[] {
  const out: number[] = [];
  for (let h = Math.ceil(startMin / 60); h < endMin / 60; h++) out.push(h);
  return out;
}

// ── B-reservas-7a · poner una ausencia, en tres toques ─────────────────
//
// Donde Sole las escribe hoy: en la columna de la persona, no en un ajuste
// del admin. «Ana libre» el miércoles entero; «ISA NO» de 9:00 a 10:30.
//
// El camino mínimo son TRES toques: el ⋯ de la cabecera (1), "No está en
// todo el día" (2) — y ese ya guarda. El de rango son tres también si los
// valores por defecto sirven: ⋯ (1), "No está a ratos" (2), "Guardar" (3).
//
// Por debajo es un `BookingBlock scope=STAFF` por la API que ya existe, y
// que ya podían llamar el cajero y el owner. No hay entidad nueva.

function AbsenceSheet(props: {
  staff: AgendaStaff;
  openRanges: OpenRange[] | null;
  slotMin: number;
  onCancel: () => void;
  onSave: (startTime: string, endTime: string, reason: string) => void;
}) {
  const { staff, openRanges, slotMin } = props;
  // El rango por defecto: desde donde abre su columna, una hora. Si no hay
  // horario configurado, las 09:00 — la hora a la que abre casi todo.
  const baseStart = openRanges?.[0] ? minOf(openRanges[0]!.startTime) : 9 * 60;
  const baseEnd = Math.min(baseStart + 60, 24 * 60);
  const [modo, setModo] = useState<"menu" | "rango">("menu");
  const [from, setFrom] = useState(hhmm(baseStart));
  const [to, setTo] = useState(hhmm(baseEnd));
  const [reason, setReason] = useState("");

  // Las horas que se pueden elegir, en la RETÍCULA del centro: ofrecer las
  // 10:15 con la retícula a 30 sería ofrecer una hora que no existe.
  const horas: string[] = [];
  for (let m = 0; m <= 24 * 60; m += slotMin) horas.push(hhmm(m));

  const invalido = minOf(to) <= minOf(from);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 p-3">
      <div className="w-full md:w-96 bg-white rounded-2xl p-4 shadow-xl">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-[15px] font-semibold text-mipiace-ink flex-1">
            {staff.displayName}
          </h2>
          <button
            onClick={props.onCancel}
            className="h-9 w-9 rounded-xl hover:bg-slate-100 flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {modo === "menu" ? (
          <div className="flex flex-col gap-2">
            <button
              data-ausencia-dia-entero
              onClick={() =>
                props.onSave(ALL_DAY_START, ALL_DAY_END, reason)
              }
              className="h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium"
            >
              No está en todo el día
            </button>
            <button
              data-ausencia-rango
              onClick={() => setModo("rango")}
              className="h-12 rounded-2xl bg-mipiace-stone hover:bg-slate-200 text-[14px] font-medium text-mipiace-ink"
            >
              No está a ratos
            </button>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="Motivo (opcional)"
              aria-label="Motivo"
              className="h-11 px-3 rounded-2xl bg-mipiace-stone border border-slate-200 text-[14px]"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <select
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="Desde"
                className="h-11 flex-1 px-2 rounded-2xl bg-mipiace-stone border border-slate-200 text-[14px] tabular-nums"
              >
                {horas.slice(0, -1).map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <span className="text-[13px] text-slate-400">a</span>
              <select
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="Hasta"
                className="h-11 flex-1 px-2 rounded-2xl bg-mipiace-stone border border-slate-200 text-[14px] tabular-nums"
              >
                {horas.slice(1).map((h) => (
                  <option key={h} value={h}>
                    {h === "24:00" ? "24:00 (fin del día)" : h}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="Motivo (opcional)"
              aria-label="Motivo"
              className="h-11 px-3 rounded-2xl bg-mipiace-stone border border-slate-200 text-[14px]"
            />
            {invalido && (
              <p className="text-[12.5px] text-red-600">
                La hora de fin tiene que ser posterior a la de inicio.
              </p>
            )}
            <button
              data-ausencia-guardar
              disabled={invalido}
              onClick={() => props.onSave(from, to, reason)}
              className="h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark disabled:bg-slate-300 text-white text-[14px] font-medium"
            >
              Guardar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Columna de un profesional ──────────────────────────────────────────

function StaffColumn(props: {
  staff: AgendaStaff;
  appts: AgendaAppointment[];
  nowMin: number | null;
  // B-reservas-6a · hasta qué minuto del día ya ha pasado (el suelo).
  // `null` = un día futuro, nada ha pasado.
  pastUntilMin: number | null;
  // B-reservas-7a · la franja visible y la retícula, que ya no son
  // constantes del módulo: salen del horario del centro de ESE día.
  dayStartMin: number;
  dayEndMin: number;
  slotMin: number;
  // Los tramos reservables de esta columna (turno ∩ centro). `null` = este
  // centro no tiene horario configurado ⇒ no se apaga nada, que es como se
  // comportaba antes del bloque. `[]` = nada es reservable hoy.
  open: OpenRange[] | null;
  absences: AgendaAbsence[];
  onAbsence: (a: AgendaAbsence) => void;
  // El gesto que pone una ausencia. Ausente en la columna "Sin asignar",
  // que no es de nadie.
  onMenu?: () => void;
  onSlot: (minutes: number) => void;
  onAppt: (a: AgendaAppointment) => void;
  labelOf: (a: AgendaAppointment) => string;
  clientOf: (a: AgendaAppointment) => string;
}) {
  const {
    staff,
    appts,
    nowMin,
    pastUntilMin,
    dayStartMin,
    dayEndMin,
    slotMin,
    open,
    absences,
  } = props;
  const totalH = (dayEndMin - dayStartMin) * PX_PER_MIN;
  // B-reservas-mostrador F2 · el color de ESTA columna, y el tinte con el que
  // se pintan sus citas. Se calculan una vez por columna, no por tarjeta.
  const colorStaff = colorDeProfesional(staff.userId, staff.color);
  const tinteStaff = tinteDeProfesional(staff.userId, staff.color);
  const pastH =
    pastUntilMin == null
      ? 0
      : Math.max(
          0,
          (Math.min(pastUntilMin, dayEndMin) - dayStartMin) * PX_PER_MIN,
        );
  // B-reservas-7a · lo que NO es reservable de esta columna.
  const cerradas = closedBands(open, dayStartMin, dayEndMin);
  // Y las líneas de la retícula, que antes eran sólo las horas en punto.
  // Con 30 se ven las medias: la cajera tiene que poder contar las bandas
  // que va a tocar.
  const gridLines: number[] = [];
  for (
    let m = Math.ceil(dayStartMin / slotMin) * slotMin;
    m < dayEndMin;
    m += slotMin
  ) {
    gridLines.push(m);
  }
  /** ¿Esta cita se sale del horario de la columna o pisa una ausencia?
   *  Pasa cuando el festivo o la ausencia se pusieron DESPUÉS. Se sigue
   *  viendo y se sigue pudiendo cobrar: sólo se marca. */
  function fueraDeHorario(a: AgendaAppointment): boolean {
    const s = localMinutes(a.start);
    const e0 = localMinutes(a.end);
    const e = e0 <= s ? 24 * 60 : e0;
    if (open != null) {
      const dentro = open.some(
        (r) => minOf(r.startTime) <= s && e <= minOf(r.endTime),
      );
      if (!dentro) return true;
    }
    return absences.some(
      (ab) => s < minOf(ab.endTime) && minOf(ab.startTime) < e,
    );
  }
  return (
    <div className="w-44 md:w-52 shrink-0 border-l border-slate-200">
      <div
        className="sticky top-0 z-10 h-10 flex items-center gap-2 px-2 bg-white border-b border-slate-200"
        // B-reservas-mostrador F2 · la cabecera usa el MISMO color base que el
        // tinte de sus tarjetas: si la columna es morada, sus citas son
        // moradas. Una profesional sin color ya no cae en el gris de todas —
        // tiene el suyo, derivado de su id y por tanto estable.
        style={{ borderTop: `3px solid ${colorStaff}` }}
      >
        <span className="text-[13px] font-semibold text-mipiace-ink truncate flex-1">
          {staff.displayName}
        </span>
        {/* B-reservas-7a · TOQUE 1 de 3 para poner una ausencia. Va en la
            cabecera de la columna porque es donde Sole escribe «Ana libre»
            en su Excel: en la fila de la persona, no en un ajuste. */}
        {props.onMenu && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.onMenu!();
            }}
            data-ausencia-menu={staff.userId}
            className="h-8 w-8 shrink-0 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"
            aria-label={`Opciones de ${staff.displayName}`}
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        )}
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
        {/* B-reservas-7a · lo que NO es reservable de esta columna: fuera
            del horario del centro, o fuera del turno de esta profesional.
            Va por debajo de las citas —una cita que quedó fuera se sigue
            viendo y se sigue cobrando— y no se puede tocar para crear. */}
        {cerradas.map((b) => (
          <div
            key={`cerrada-${b.from}`}
            aria-hidden
            data-no-reservable={`${hhmm(b.from)}-${hhmm(b.to)}`}
            style={{
              top: (b.from - dayStartMin) * PX_PER_MIN,
              height: (b.to - b.from) * PX_PER_MIN,
            }}
            // B-reservas-mostrador F2 · el rayado BAJA de tono (0,18 → 0,09 y
            // el fondo de slate-100 a slate-50). Hasta este bloque era lo que
            // más gritaba de la pantalla: una banda que dice que ahí NO se
            // puede hacer nada pesaba más que la cita, que es lo único que
            // importa. Sigue viéndose —lo fija `agenda-horario.test.tsx`— pero
            // ya no compite con las tarjetas teñidas.
            className="absolute left-0 right-0 bg-slate-50 pointer-events-none bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,rgba(148,163,184,0.09)_5px,rgba(148,163,184,0.09)_10px)]"
          />
        ))}
        {/* rejilla: una línea por franja de la RETÍCULA del centro, más
            marcada en las horas en punto. Con 30 se ven las medias. */}
        {gridLines.map((m) => (
          <div
            key={m}
            style={{ top: (m - dayStartMin) * PX_PER_MIN }}
            className={`absolute left-0 right-0 border-t ${
              m % 60 === 0 ? "border-slate-200" : "border-slate-100"
            }`}
          />
        ))}
        {/* B-reservas-7a · las AUSENCIAS, con su motivo. Es el «Ana libre»
            que Sole escribe en la celda. Se tocan para quitarlas. */}
        {absences.map((ab) => {
          const from = Math.max(minOf(ab.startTime), dayStartMin);
          const to = Math.min(minOf(ab.endTime), dayEndMin);
          if (to <= from) return null;
          return (
            <button
              key={`${ab.id ?? "sin-id"}-${ab.startTime}`}
              onClick={(e) => {
                e.stopPropagation();
                props.onAbsence(ab);
              }}
              data-ausencia={ab.id ?? "sin-id"}
              style={{
                top: (from - dayStartMin) * PX_PER_MIN,
                height: (to - from) * PX_PER_MIN,
              }}
              // SIN `z-index`: el orden del DOM ya la deja por encima de las
              // bandas apagadas y por debajo de las citas, que van después.
              // Un `z-10` aquí la subía por encima de la cabecera sticky de
              // la columna y tapaba el nombre de la profesional — lo cogió
              // el bucle visual, no un test.
              className="absolute left-0.5 right-0.5 rounded-lg bg-rose-50/85 border border-dashed border-rose-300 px-2 py-1 text-left overflow-hidden hover:bg-rose-100"
            >
              <div className="text-[11px] font-semibold text-rose-800 truncate">
                {ab.reason ?? "No está"}
              </div>
              <div className="text-[10.5px] text-rose-600 truncate">
                {ab.startTime === "00:00" && ab.endTime === "24:00"
                  ? "todo el día"
                  : `${ab.startTime}–${ab.endTime}`}
              </div>
            </button>
          );
        })}
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
          const finMin =
            localMinutes(a.end) <= localMinutes(a.start)
              ? 24 * 60
              : localMinutes(a.end);
          const height = Math.max(
            22,
            (finMin - localMinutes(a.start)) * PX_PER_MIN,
          );
          // B-reservas-7a · una cita que quedó fuera del horario —porque el
          // festivo o la ausencia se pusieron DESPUÉS— se sigue viendo y se
          // sigue pudiendo cobrar. Sólo se marca, para que la cajera sepa
          // que hay algo que avisar.
          const fuera = fueraDeHorario(a);
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
                // B-reservas-mostrador F2 · la cita de una profesional se tiñe
                // con SU color. La local y la rechazada de 6a NO: su ámbar y
                // su rojo son lo que las distingue de una cita de verdad, y
                // teñirlas sería borrar esa diferencia.
                ...(local
                  ? {}
                  : {
                      background: tinteStaff,
                      borderLeft: `4px solid ${tonoDeEstado(STATUS_COLOR[a.status])}`,
                    }),
              }}
              // Ganchos estables para el bucle visual. El tinte de verdad va
              // en `style`, que es lo que el navegador pinta: `data-tinte` es
              // sólo para poder localizarlo desde Playwright.
              data-cita={a.id}
              data-tinte={local ? undefined : tinteStaff}
              className={
                local
                  ? // A la MITAD DERECHA de la columna. El bucle visual
                    // destapó por qué hace falta: una cita rechazada por
                    // TAKEN está, por definición, encima de la que ocupó
                    // su hueco — y a ancho completo la tapaba. La agenda
                    // no tiene layout de solape porque hasta ahora el
                    // EXCLUDE lo hacía imposible; con las citas locales
                    // deja de serlo, y ésta es la respuesta barata: las
                    // dos se ven.
                    `absolute left-1/2 right-1 rounded-lg px-2 py-1 text-left overflow-hidden border-2 border-dashed ${
                      rechazada
                        ? "bg-red-50 border-red-300"
                        : "bg-amber-50 border-amber-300"
                    }`
                  : // Sin `z-index`, como en B4: va la última en el DOM, así
                    // que ya queda por encima de las bandas y de las
                    // ausencias, y por DEBAJO de la cabecera sticky y de la
                    // línea de "ahora" — que es como estaba y no lo cambia
                    // este bloque.
                    //
                    // B-reservas-mostrador F2 · sin `bg-white`: el fondo lo
                    // pone el tinte de la profesional por `style`.
                    `absolute left-1 right-1 rounded-lg shadow-sm px-2 py-1 text-left overflow-hidden hover:shadow-md ${
                      fuera
                        ? "border border-amber-300 ring-1 ring-amber-200"
                        : "border border-slate-200"
                    }`
              }
              data-fuera-de-horario={!local && fuera ? "1" : undefined}
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
                {/* B-reservas-7a · si la tarjeta NO da para dos líneas, la
                    marca va aquí. Meterla en una segunda línea que no cabe
                    es el fallo que B-5 F8 arregló con `CARD_TWO_LINE_MIN_H`:
                    el `overflow-hidden` corta las letras por la mitad y se
                    lee como un fallo de pintado. Lo cogió el bucle visual,
                    no un test. */}
                {!local && fuera && height < CARD_TWO_LINE_MIN_H
                  ? " · fuera de horario"
                  : ""}
              </div>
              {/* B-reservas-5 F8 · la segunda línea sólo si cabe entera.
                  Una cita de 30 min mide 33 px y el contenido pide 40:
                  el `overflow-hidden` cortaba "Corte de pelo" por la
                  mitad de las letras, que se lee como un fallo de pintado.
                  Cortar limpio y dejar el servicio para el detalle es
                  mejor que enseñar media palabra. */}
              {/* B-reservas-mostrador F2 · `slate-600`, no `slate-500`.
                  Sobre blanco los dos pasaban AA, pero sobre un tinte que se
                  vea slate-500 pediría un fondo de luminancia 0,943 — o sea,
                  blanco. Con slate-600 el tinte cabe (5,56:1 contra el
                  objetivo del bloque). El número vive en
                  `lib/staffColor.ts` y lo fija `staff-color.test.ts`. */}
              {height >= CARD_TWO_LINE_MIN_H && (
                <div
                  className={`text-[10.5px] truncate ${
                    local ? "text-slate-500" : "text-slate-600"
                  }`}
                >
                  {!local && fuera ? "fuera de horario · " : ""}
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
  // B-reservas-7a · el horario del centro de ESE día. Sirve para que "no
  // hay huecos" deje de ser una sola frase para tres causas distintas.
  dayInfo: AgendaDayInfo | undefined;
  staffName: string | null;
  // El 409 del servidor con su frase y sus alternativas.
  bookError: { message: string; alternatives: AvailabilitySlot[] } | null;
  onPickAlternative: (start: string) => void;
  onCancel: () => void;
  onReserve: () => void;
  onReserveAndCharge: () => void;
}) {
  const { draft, setDraft, services, date, isPastDay, bookError, dayInfo } =
    props;
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

  // B-reservas-mostrador F4 · SIN DURACIÓN NO HAY FIN. Hasta este bloque
  // bastaba con tener la hora de inicio: con cero servicios elegidos
  // `totalDuration` es 0 y la etiqueta decía «fin 12:30» para una cita que
  // empieza a las 12:30. En el AP11 quedó fotografiado
  // (`docs/qa/2026-09-13-ap11/20-lunes-cita.png`). Decir una hora de fin
  // falsa es peor que no decir ninguna: la cajera la lee por teléfono.
  const endHHMM =
    draft.start && totalDuration > 0
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

  /** Por qué no hay huecos: el centro cerrado, nadie con turno, o el día
   *  lleno. Se mira en ese orden porque es el orden en que se arreglan. */
  function sinHuecosPorque(): string {
    if (dayInfo?.closed) {
      return dayInfo.closed.name
        ? `El centro está cerrado ese día · ${dayInfo.closed.name}.`
        : "El centro está cerrado ese día.";
    }
    const quien = draft.staffUserId;
    if (quien && dayInfo) {
      const suyos = dayInfo.staffOpen?.[quien] ?? [];
      if (suyos.length === 0) {
        return `${props.staffName ?? "Esa profesional"} no tiene turno ese día.`;
      }
      const todoElDia = (dayInfo.absences ?? []).some(
        (a) =>
          (a.staffUserId === quien || a.staffUserId === null) &&
          minOf(a.startTime) <= minOf(suyos[0]!.startTime) &&
          minOf(a.endTime) >= minOf(suyos[suyos.length - 1]!.endTime),
      );
      if (todoElDia) {
        return `${props.staffName ?? "Esa profesional"} no está ese día.`;
      }
    }
    if (
      dayInfo &&
      !quien &&
      Object.values(dayInfo.staffOpen ?? {}).every((r) => r.length === 0)
    ) {
      return "Ese día no hay nadie con turno.";
    }
    return "No hay huecos ese día.";
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
      // B-reservas-7a · TRES CAUSAS, tres frases. "No hay huecos" era una
      // sola para las tres, y se arreglan de formas distintas: el centro
      // cerrado lo arregla el owner en los ajustes, el turno que falta lo
      // arregla el panel de Personal, y el día lleno se arregla con otro
      // día. Decirlas igual es mandar a la cajera al sitio equivocado.
      if (res.length === 0) setSearchError(sinHuecosPorque());
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : "Error buscando huecos.");
    } finally {
      setSearching(false);
    }
  }

  const canReserve = draft.serviceIds.length > 0 && !!draft.start;

  // ── B-reservas-mostrador F4 · ningún botón mudo ────────────────────
  //
  // Un botón apagado sin motivo obliga a adivinar delante de la clienta. El
  // motivo va en TEXTO VISIBLE junto al botón, nunca en un `title` ni en un
  // tooltip: `docs/ux-principles.md` §6 los prohíbe («Touch no tiene hover.
  // Las cosas se ven o no existen»).

  /** Por qué no se puede buscar hueco. `null` = sí se puede. */
  function motivoBuscarHueco(): string | null {
    if (isPastDay) return "Ese día ya ha pasado.";
    if (draft.serviceIds.length === 0) return "Elige al menos un servicio.";
    return null;
  }

  /**
   * Por qué no se puede reservar. `null` = sí se puede.
   *
   * NO nombra el cliente, y no es un olvido: desde B4 una cita SIN cliente es
   * legal a propósito —la reserva por teléfono de quien todavía no tiene
   * ficha— y `canReserve` nunca lo ha exigido. Decir «falta el cliente»
   * mandaría a la cajera a buscar un dato que no hace falta.
   */
  function motivoReservar(): string | null {
    const falta: string[] = [];
    if (draft.serviceIds.length === 0) falta.push("el servicio");
    if (!draft.start) falta.push("la hora");
    if (falta.length === 0) return null;
    return falta.length === 1
      ? `Falta ${falta[0]}.`
      : `Faltan ${falta.join(" y ")}.`;
  }

  const porQueNoSeBusca = motivoBuscarHueco();
  const porQueNoSeReserva = motivoReservar();

  // B-reservas-mostrador F1 · ¿la cita que se va a guardar es de HOY? Sale de
  // `draft.start` —el instante que se va a escribir— y no de `date`, que es
  // sólo el día que se está mirando. Sin hora elegida no hay cita que cobrar,
  // así que tampoco hay botón.
  const esDeHoy = draft.start ? centerWallDate(draft.start) === centerToday() : false;

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
                data-accion="buscar-hueco"
                onClick={findSlots}
                disabled={porQueNoSeBusca !== null || searching}
                className="w-full h-10 rounded-xl bg-mipiace-ink text-white text-[13px] font-medium disabled:opacity-40"
              >
                {searching ? "Buscando…" : "Buscar hueco"}
              </button>
              {/* B-reservas-mostrador F4 · el motivo, en texto y debajo del
                  botón que está apagado. `searching` no genera frase: la
                  etiqueta ya dice «Buscando…». */}
              {porQueNoSeBusca && !searching && (
                <div
                  data-motivo="buscar-hueco"
                  className="text-[12px] text-slate-500 mt-1.5"
                >
                  {porQueNoSeBusca}
                </div>
              )}
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

      {/* Acciones primarias.

          B-reservas-mostrador F1 · «Reservar» es EL botón, y «Reservar y
          cobrar» sólo existe si la cita es de hoy.

          Por qué: un cobro entra en el turno ABIERTO, que es el de hoy. Si
          alguien reserva para el jueves y pulsa el primario por inercia, el
          dinero del jueves cae en el arqueo de hoy — y deshacerlo no es
          anular (no existe) sino devolver, que cae en el turno del día en que
          se haga. Un toque de más descuadra DOS arqueos.

          Y «de hoy» sale de `draft.start`, no del día que se está mirando:
          `start` es el instante que se va a guardar, y cambiar de día con el
          panel abierto NO lo mueve. Derivarlo de `date` haría aparecer el
          botón sobre una cita que sigue siendo del jueves.

          El orden del DOM es el orden del tabulador: «Reservar» primero. No
          hay `<form>` ni `type="submit"` en este panel, así que no existe un
          Enter que cobre; lo que se fija aquí es que no nazca uno por
          descuido al reordenar. */}
      <div className="shrink-0 p-4 border-t border-slate-100 space-y-2 bg-white">
        {/* B-reservas-mostrador F4 · el motivo va ENCIMA del botón apagado,
            que es donde cae la mirada al venir del cuerpo del panel. Y en una
            ranura de alto fijo, por lo mismo que el secundario de F1: el pie
            está anclado abajo, así que cualquier fila que aparezca o
            desaparezca mueve los dos botones — y moverlos justo cuando la
            cajera va a tocar es cómo se cobra lo que no se quería cobrar. */}
        <div className="h-5 flex items-center justify-center">
          {porQueNoSeReserva && (
            <p
              data-motivo="reservar"
              className="text-[12.5px] text-slate-500 text-center leading-snug"
            >
              {porQueNoSeReserva}
            </p>
          )}
        </div>
        <button
          data-accion="reservar"
          onClick={props.onReserve}
          disabled={!canReserve}
          className="w-full h-12 rounded-xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[15px] font-semibold disabled:opacity-40"
        >
          Reservar
        </button>
        {/* El hueco del secundario NO desaparece: el pie es `shrink-0` al
            final de un `flex-col`, así que quitarle una fila subiría el borde
            y bajaría el primario de golpe. Cuando la cita no es de hoy, esa
            misma fila la ocupa la razón. Ni salto ni hueco muerto. */}
        <div className="h-11 flex items-center justify-center">
          {esDeHoy ? (
            <button
              data-accion="reservar-y-cobrar"
              onClick={props.onReserveAndCharge}
              disabled={!canReserve}
              className="w-full h-11 rounded-xl border border-slate-300 text-mipiace-ink text-[14px] font-medium disabled:opacity-40"
            >
              Reservar y cobrar
            </button>
          ) : (
            <p
              data-cobro-otro-dia
              className="text-[12.5px] text-slate-500 text-center leading-snug"
            >
              Se cobra el día de la cita.
            </p>
          )}
        </div>
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
          {/* B-reservas-mostrador F2 · el mismo tono que el filete de la
              tarjeta. Con `STATUS_COLOR` crudo este chip pintaba texto BLANCO
              sobre el ámbar de "Pendiente": 2,15:1, muy por debajo de AA. Era
              un defecto de master que el bloque cierra de paso. */}
          <span
            data-estado={appt.status}
            className="inline-block text-[12px] font-medium px-2 py-0.5 rounded-md text-white"
            style={{ background: tonoDeEstado(STATUS_COLOR[appt.status]) }}
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
