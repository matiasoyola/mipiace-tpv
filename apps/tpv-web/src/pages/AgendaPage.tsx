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
import type { CartLine } from "../lib/cart.js";
import { newId } from "../lib/ids.js";
import {
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

// ── Helpers de zona horaria (Europe/Madrid) para pintar ────────────────

const TZ = "Europe/Madrid";
const dayStartMin = 8 * 60; // 08:00
const dayEndMin = 21 * 60; // 21:00
const PX_PER_MIN = 1.1;

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

function localHHMM(iso: string): string {
  return partsFmt.format(new Date(iso));
}

function todayLocalDate(): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(new Date());
}

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
  onCheckoutLines?: (lines: CartLine[]) => void;
}

export function AgendaPage({ onClose, onCheckoutLines }: AgendaPageProps) {
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
    const res = await createAppointment({
      clientId: draft.clientId,
      items: draft.serviceIds.map((serviceId) => ({
        serviceId,
        staffUserId: draft.staffUserId,
      })),
      start: draft.start,
      source: "PRESENCIAL",
    });
    if (!res.ok) {
      flash(res.message);
      return;
    }
    setDraft(null);
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
    // Cargar las líneas pre-pobladas en el carrito del TPV (camino de cobro
    // existente). Reconstruimos CartLine desde el ticket DRAFT del server.
    const lines: CartLine[] = res.ticket.lines.map((l) => ({
      id: newId(),
      productId: l.productId,
      variantId: null,
      holdedProductId: null,
      sku: l.sku,
      nameSnapshot: l.nameSnapshot,
      units: Number(l.units),
      unitPrice: Number(l.unitPrice),
      unitPriceOverride: null,
      priceGross: Number(l.unitPrice) * (1 + Number(l.taxRate) / 100),
      discountPct: 0,
      taxRate: Number(l.taxRate),
      modifiers: [],
    }));
    if (onCheckoutLines) {
      onCheckoutLines(lines);
      onClose();
    } else {
      flash("Ticket pre-poblado abierto en caja.");
    }
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
    setDetail(null);
    setDraft({
      clientId: null,
      clientName: null,
      serviceIds: [],
      staffUserId,
      start: localToIso(date, Math.round(minutes / 15) * 15),
    });
  }

  const isToday = date === todayLocalDate();
  const nowMin = localMinutes(new Date().toISOString());

  return (
    <div className="fixed inset-0 z-40 bg-mipiace-stone flex flex-col font-sans">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 md:px-6 h-16 bg-white border-b border-slate-200 shrink-0">
        <button
          onClick={onClose}
          className="h-11 w-11 rounded-2xl hover:bg-slate-100 flex items-center justify-center text-mipiace-ink"
          aria-label="Volver"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2.25} />
        </button>
        <h1 className="text-[18px] font-semibold text-mipiace-ink">Agenda</h1>
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => setDate(addDays(date, -1))}
            className="h-9 w-9 rounded-xl hover:bg-slate-100 flex items-center justify-center"
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
            className="h-9 w-9 rounded-xl hover:bg-slate-100 flex items-center justify-center"
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
            className="h-10 px-2 rounded-xl bg-mipiace-stone border border-slate-200 text-[13px]"
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
          className="h-11 px-4 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium flex items-center gap-2"
        >
          <Plus className="w-[18px] h-[18px]" strokeWidth={2.25} />
          <span className="hidden sm:inline">Nueva cita</span>
        </button>
      </div>

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
              {/* Regla de horas */}
              <div className="w-14 shrink-0 sticky left-0 z-10 bg-mipiace-stone">
                {hourRows().map((h) => (
                  <div
                    key={h}
                    style={{ height: 60 * PX_PER_MIN }}
                    className="text-[11px] text-slate-400 text-right pr-2 -mt-2"
                  >
                    {String(h).padStart(2, "0")}:00
                  </div>
                ))}
              </div>
              {/* Columnas por profesional */}
              {columns.map((s) => (
                <StaffColumn
                  key={s.userId}
                  staff={s}
                  appts={apptsByStaff.get(s.userId) ?? []}
                  nowMin={isToday ? nowMin : null}
                  onSlot={(min) => openSlotFirst(s.userId, min)}
                  onAppt={setDetail}
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
                  onSlot={(min) => openSlotFirst(null, min)}
                  onAppt={setDetail}
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
            onCancel={() => setDraft(null)}
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
  onSlot: (minutes: number) => void;
  onAppt: (a: AgendaAppointment) => void;
  labelOf: (a: AgendaAppointment) => string;
  clientOf: (a: AgendaAppointment) => string;
}) {
  const { staff, appts, nowMin } = props;
  const totalH = (dayEndMin - dayStartMin) * PX_PER_MIN;
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
        className="relative"
        style={{ height: totalH }}
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const y = e.clientY - rect.top;
          props.onSlot(dayStartMin + y / PX_PER_MIN);
        }}
      >
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
                borderLeft: `4px solid ${STATUS_COLOR[a.status]}`,
              }}
              className="absolute left-1 right-1 rounded-lg bg-white shadow-sm border border-slate-200 px-2 py-1 text-left overflow-hidden hover:shadow-md"
            >
              <div className="text-[11px] font-semibold text-mipiace-ink truncate">
                {localHHMM(a.start)} · {props.clientOf(a)}
              </div>
              <div className="text-[10.5px] text-slate-500 truncate">
                {props.labelOf(a)}
              </div>
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
  onCancel: () => void;
  onReserve: () => void;
  onReserveAndCharge: () => void;
}) {
  const { draft, setDraft, services, date } = props;
  const picker = useClientPicker();
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

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
    <div className="w-full md:w-96 shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-y-auto">
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

      <div className="p-4 space-y-4">
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
                disabled={draft.serviceIds.length === 0 || searching}
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
      </div>

      {/* Acciones primarias */}
      <div className="mt-auto p-4 border-t border-slate-100 space-y-2 sticky bottom-0 bg-white">
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
