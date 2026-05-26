// Pantalla de búsqueda de tickets pasados (B4 §4). Filtros, badges
// sync, acciones: reimprimir (B5), reenviar email, iniciar devolución,
// ver detalle, abrir en Holded.
//
// Diseño: lista paginada con cursor. La pantalla la abre el cajero
// desde la SalePage (botón Caja → Tickets); se monta como overlay full.

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Mail,
  Printer,
  RotateCcw,
  Search,
  XCircle,
} from "lucide-react";

import { ApiError, apiWithCashier } from "../api.js";
import { getCachedBusinessType } from "../lib/catalog.js";
import { vocab } from "../lib/vocab.js";
import { RefundOverlay } from "./RefundPage.js";

const formatEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

// Renderiza el `modifiers` jsonb del backend en una sola línea de texto.
// El campo puede ser string[] (legacy ad-hoc) o object[] estructurado
// (B-Bar-Modifiers). Discrimina por tipo del primer elemento.
function formatModifierBreadcrumb(raw: unknown[]): string {
  if (raw.length === 0) return "";
  const first = raw[0];
  if (typeof first === "string") {
    return (raw as string[]).join(" · ");
  }
  return raw
    .map((entry) => {
      if (entry && typeof entry === "object" && "label" in entry) {
        const e = entry as { groupName?: string; label: string };
        return e.groupName ? `${e.groupName}: ${e.label}` : e.label;
      }
      return null;
    })
    .filter((s): s is string => s != null)
    .join(" · ");
}

interface TicketRow {
  id: string;
  internalNumber: string;
  externalId: string;
  status:
    | "DRAFT"
    | "PAID"
    | "PENDING_SYNC"
    | "SYNCED"
    | "SYNC_FAILED"
    | "VOIDED"
    // B-TPV-Bugfix v1 · Bug-01: TEST es el status de los tickets
    // generados por el cajero técnico en modo prueba (B-OnboardingV2).
    // Estaba ausente aquí, lo que provocaba un TypeError al
    // destructurar `map[status]` en StatusBadge y crasheaba toda la
    // pantalla del historial cuando el tenant tenía algún ticket
    // emitido en modo prueba.
    | "TEST";
  total: number;
  totalTax: number;
  totalDiscount: number;
  holdedDocumentId: string | null;
  holdedDocNumber: string | null;
  contactHoldedId: string | null;
  emailIntent: string | null;
  notes: string | null;
  // v1.3-Servicios-Pinta · Lote 3: profesional que atendió (SERVICES).
  attendedBy: string | null;
  createdAt: string;
  paidAt: string | null;
  syncedAt: string | null;
  syncError: unknown;
  register?: { id: string; name: string; storeName: string };
  lines: Array<{
    id: string;
    nameSnapshot: string;
    sku: string;
    units: number;
    unitPrice: number;
    total: number;
    discountPct: number;
    taxRate: number;
    // Mixto: array de strings (legacy ad-hoc) o array de
    // ModifierSnapshotEntry (B-Bar-Modifiers). El renderer del histórico
    // discrimina por tipo del primer elemento.
    modifiers: unknown[];
  }>;
  payments: Array<{
    id: string;
    method: string;
    amount: number;
    meta: unknown;
  }>;
  refunds: Array<{ id: string; total: number; createdAt: string; status: string }>;
}

export function TicketsHistoryPage(props: { onClose: () => void }) {
  // v1.3-Servicios-Pinta · Lote 1: vertical del tenant para adaptar el
  // título de la pantalla, el copy de los filtros y el botón "Iniciar
  // devolución". El historial es la "ficha del cliente" en servicios,
  // así que aquí el copy importa más que en RETAIL.
  const businessType = getCachedBusinessType();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");
  // Mejora-03: filtro por rango de fechas. Estado en formato
  // YYYY-MM-DD (lo que da el <input type="date">). Vacío = sin filtro.
  // El backend acepta `from` y `to` en formato ISO date-time; los
  // convertimos al enviar para que `from` sea inicio del día (00:00)
  // y `to` sea final del día (23:59:59) en la zona local del cajero.
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [selected, setSelected] = useState<TicketRow | null>(null);
  const [refunding, setRefunding] = useState<TicketRow | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q.trim());
      if (status) params.set("status", status);
      if (dateFrom) {
        // Inicio del día local → ISO UTC
        params.set("from", new Date(`${dateFrom}T00:00:00`).toISOString());
      }
      if (dateTo) {
        // Final del día local → ISO UTC
        params.set("to", new Date(`${dateTo}T23:59:59.999`).toISOString());
      }
      params.set("limit", "50");
      const res = await apiWithCashier<{ items: TicketRow[] }>(
        `/tickets?${params.toString()}`,
      );
      setTickets(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, dateFrom, dateTo]);

  return (
    <div className="fixed inset-0 z-40 bg-mipiace-stone flex flex-col font-sans">
      <header className="h-[88px] border-b border-slate-200 bg-white flex items-center px-5 md:px-8 gap-3">
        <button
          onClick={props.onClose}
          className="h-10 w-10 rounded-xl hover:bg-slate-50 text-slate-600 flex items-center justify-center"
          aria-label="Volver"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2.1} />
        </button>
        <h1 className="text-[20px] font-semibold text-mipiace-ink tracking-tight">
          {businessType === "SERVICES"
            ? vocab("historyTitle", businessType)
            : "Tickets"}
        </h1>
        <div className="flex-1 max-w-xl ml-auto">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Número interno, fiscal o externalId…"
              className="h-12 w-full pl-11 pr-4 text-[14px] bg-mipiace-stone border border-transparent rounded-2xl focus:outline-none focus:ring-2 focus:ring-mipiace-coral/40 focus:bg-white focus:border-mipiace-coral/30"
            />
          </div>
        </div>
      </header>

      <div className="px-5 md:px-8 py-3 border-b border-slate-200 bg-white flex items-center gap-2 overflow-x-auto">
        <FilterChip
          label="Todos"
          active={status === ""}
          onClick={() => setStatus("")}
        />
        <FilterChip
          label="Sincronizados"
          active={status === "SYNCED"}
          onClick={() => setStatus("SYNCED")}
        />
        <FilterChip
          label="Pendientes"
          active={status === "PENDING_SYNC"}
          onClick={() => setStatus("PENDING_SYNC")}
        />
        <FilterChip
          label="Fallidos"
          active={status === "SYNC_FAILED"}
          onClick={() => setStatus("SYNC_FAILED")}
        />
        {/* Mejora-03: rango de fechas. Separador visual + dos inputs
            date nativos. Si solo se rellena uno, el otro queda
            abierto (sin tope). Botón "Limpiar fechas" aparece sólo
            cuando hay al menos un filtro activo. */}
        <div className="h-7 w-px bg-slate-200 mx-1 shrink-0" />
        <div className="flex items-center gap-1.5 shrink-0">
          <label className="text-[12.5px] text-slate-500" htmlFor="ticketsHistoryFrom">
            Desde
          </label>
          <input
            id="ticketsHistoryFrom"
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-10 px-2.5 rounded-xl bg-mipiace-stone border border-transparent text-[13px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-1 focus:ring-mipiace-coral/30 focus:outline-none"
          />
          <label className="text-[12.5px] text-slate-500 ml-1" htmlFor="ticketsHistoryTo">
            Hasta
          </label>
          <input
            id="ticketsHistoryTo"
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-10 px-2.5 rounded-xl bg-mipiace-stone border border-transparent text-[13px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-1 focus:ring-mipiace-coral/30 focus:outline-none"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              className="h-10 px-2 text-[12px] rounded-xl text-slate-500 hover:bg-slate-100"
              title="Limpiar filtro de fechas"
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto p-5 md:p-8 max-w-4xl w-full mx-auto">
        {error && (
          <div className="text-[13px] text-red-700 bg-red-50 rounded-xl p-3 mb-4">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center text-slate-500 gap-2 py-10">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
          </div>
        ) : tickets.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-7 text-center text-[14px] text-slate-500">
            No hay {vocab("ticketNoun", businessType).toLowerCase()}s que coincidan.
          </div>
        ) : (
          <ul className="space-y-2.5">
            {tickets.map((t) => (
              <TicketRowCard
                key={t.id}
                ticket={t}
                showAttendedBy={businessType === "SERVICES"}
                onOpen={() => setSelected(t)}
              />
            ))}
          </ul>
        )}
      </main>

      {selected && (
        <TicketDetailDrawer
          ticket={selected}
          businessType={businessType}
          onClose={() => setSelected(null)}
          onRefund={() => {
            setRefunding(selected);
            setSelected(null);
          }}
          onChanged={() => {
            refresh();
            setSelected(null);
          }}
        />
      )}
      {refunding && (
        <RefundOverlay
          ticket={refunding}
          onClose={() => setRefunding(null)}
          onConfirmed={() => {
            setRefunding(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "h-10 px-4 rounded-2xl bg-mipiace-coral text-white text-[13px] font-medium"
          : "h-10 px-4 rounded-2xl bg-mipiace-stone hover:bg-slate-100 text-[13px] font-medium text-mipiace-ink"
      }
    >
      {label}
    </button>
  );
}

function TicketRowCard({
  ticket,
  showAttendedBy,
  onOpen,
}: {
  ticket: TicketRow;
  showAttendedBy: boolean;
  onOpen: () => void;
}) {
  // v1.3 Lote 3 · botón compacto de reimprimir en la row. Usamos div+
  // role="button" arriba para no anidar <button> dentro de <button>
  // (HTML inválido). El mini-botón hace stopPropagation para no abrir
  // el detalle cuando el cajero sólo quiere reimprimir desde la lista.
  const [reprinting, setReprinting] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const canReprint = ticket.status !== "DRAFT" && ticket.status !== "VOIDED";
  async function reprint(e: React.MouseEvent) {
    e.stopPropagation();
    if (reprinting) return;
    setReprinting(true);
    setHint(null);
    try {
      await apiWithCashier(`/tickets/${ticket.id}/reprint`, { method: "POST" });
      setHint("Enviado a impresora");
      window.setTimeout(() => setHint(null), 2500);
    } catch (err) {
      setHint(err instanceof ApiError ? err.message : "Error");
      window.setTimeout(() => setHint(null), 3500);
    } finally {
      setReprinting(false);
    }
  }
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpen();
        }}
        className="w-full bg-white rounded-2xl border border-slate-200 hover:border-mipiace-coral/40 p-4 flex items-center gap-4 text-left cursor-pointer"
      >
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] font-medium text-mipiace-ink truncate flex items-center gap-2">
            <span className="tabular-nums">#{ticket.internalNumber}</span>
            {ticket.holdedDocNumber && (
              <span className="text-[12.5px] text-slate-400 tabular-nums">
                · {ticket.holdedDocNumber}
              </span>
            )}
            <StatusBadge status={ticket.status} />
          </div>
          <div className="text-[12.5px] text-slate-500 mt-0.5 truncate">
            {new Date(ticket.createdAt).toLocaleString("es-ES")}
            {ticket.register && ` · ${ticket.register.name}`}
            {ticket.lines.length > 0 &&
              ` · ${ticket.lines.length} línea${ticket.lines.length === 1 ? "" : "s"}`}
            {/* v1.3-Servicios-Pinta · Lote 3: profesional que atendió.
                Solo se renderiza si el tenant es SERVICES y el campo
                tiene valor — el resto de verticales no lo usa. */}
            {showAttendedBy && ticket.attendedBy && (
              <> · Atendido por {ticket.attendedBy}</>
            )}
          </div>
          {hint && (
            <div className="text-[11.5px] text-slate-500 mt-1">{hint}</div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[16px] font-semibold tabular-nums text-mipiace-ink">
            {formatEur(ticket.total)}
          </div>
          {ticket.refunds.length > 0 && (
            <div className="text-[11.5px] text-mipiace-coral mt-0.5">
              {ticket.refunds.length} devol.
            </div>
          )}
        </div>
        {canReprint && (
          <button
            type="button"
            onClick={reprint}
            disabled={reprinting}
            title="Reimprimir ticket"
            className="h-9 w-9 rounded-lg hover:bg-slate-100 disabled:opacity-50 flex items-center justify-center text-slate-500 shrink-0"
          >
            {reprinting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Printer className="w-4 h-4" />
            )}
          </button>
        )}
        <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: TicketRow["status"] }) {
  const map: Record<TicketRow["status"], { color: string; label: string }> = {
    DRAFT: { color: "bg-slate-100 text-slate-600", label: "Draft" },
    PAID: { color: "bg-slate-100 text-slate-700", label: "Cobrado" },
    PENDING_SYNC: { color: "bg-amber-100 text-amber-800", label: "Sincronizando" },
    SYNCED: { color: "bg-emerald-100 text-emerald-700", label: "Sincronizado" },
    SYNC_FAILED: { color: "bg-red-100 text-red-700", label: "Error" },
    VOIDED: { color: "bg-slate-100 text-slate-500", label: "Anulado" },
    // B-TPV-Bugfix v1 · Bug-01: tickets de modo prueba. Amarillo
    // pastel para distinguirlos visualmente de los reales sin
    // alarmar (no es un error).
    TEST: { color: "bg-amber-50 text-amber-700 border border-amber-200", label: "Prueba" },
  };
  // Fallback defensivo: si el backend introduce un nuevo status que
  // este front aún no conoce, mostramos el slug crudo en gris en
  // lugar de crashear la pantalla entera con un TypeError.
  const entry = map[status] ?? { color: "bg-slate-100 text-slate-500", label: status };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-medium uppercase tracking-wider ${entry.color}`}
    >
      {entry.label}
    </span>
  );
}

function TicketDetailDrawer({
  ticket,
  businessType,
  onClose,
  onRefund,
  onChanged,
}: {
  ticket: TicketRow;
  businessType: import("../lib/catalog.js").BusinessType | null;
  onClose: () => void;
  onRefund: () => void;
  onChanged: () => void;
}) {
  const [email, setEmail] = useState(ticket.emailIntent ?? "");
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  // v1.3 Lote 3 · estado de la reimpresión. El intent va a la cola del
  // bridge B5; el toast inline informa "Enviado a impresora" o error.
  const [reprinting, setReprinting] = useState(false);
  const [reprintStatus, setReprintStatus] = useState<string | null>(null);
  const canReprint =
    ticket.status !== "DRAFT" && ticket.status !== "VOIDED";

  async function reprint() {
    if (reprinting) return;
    setReprinting(true);
    setReprintStatus(null);
    try {
      await apiWithCashier(`/tickets/${ticket.id}/reprint`, {
        method: "POST",
      });
      setReprintStatus("Enviado a impresora. La copia llevará marca COPIA.");
    } catch (err) {
      setReprintStatus(
        err instanceof ApiError ? err.message : "Error al enviar a impresora",
      );
    } finally {
      setReprinting(false);
    }
  }

  async function resend() {
    if (!email) return;
    setSending(true);
    setSendStatus(null);
    try {
      await apiWithCashier(`/tickets/${ticket.id}/resend-email`, {
        method: "POST",
        body: { email },
      });
      setSendStatus("Enviado a la cola. Llegará al cliente en cuanto Holded confirme el ticket.");
    } catch (err) {
      setSendStatus(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setSending(false);
    }
  }

  const subtotal = useMemo(
    () => ticket.lines.reduce((acc, l) => acc + l.total, 0),
    [ticket.lines],
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-end p-0 sm:p-4 font-sans"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md sm:rounded-3xl border border-slate-200 p-6 md:p-7 max-h-[100vh] sm:max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[18px] font-semibold text-mipiace-ink tabular-nums">
              #{ticket.internalNumber}
            </div>
            {ticket.holdedDocNumber && (
              <div className="text-[12.5px] text-slate-500 tabular-nums">
                Fiscal {ticket.holdedDocNumber}
              </div>
            )}
            <div className="text-[12.5px] text-slate-500 mt-1">
              {new Date(ticket.createdAt).toLocaleString("es-ES")}
            </div>
          </div>
          <StatusBadge status={ticket.status} />
        </div>

        <div className="space-y-2 divide-y divide-slate-100 mt-4">
          {ticket.lines.map((l) => (
            <div key={l.id} className="flex items-center gap-3 py-2.5">
              <span className="h-8 w-8 rounded-lg bg-mipiace-stone text-mipiace-ink text-[12px] font-semibold tabular-nums flex items-center justify-center">
                {l.units}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] text-mipiace-ink truncate">{l.nameSnapshot}</div>
                {l.modifiers.length > 0 && (
                  <div className="text-[12px] text-slate-500">{formatModifierBreadcrumb(l.modifiers)}</div>
                )}
              </div>
              <div className="text-[13.5px] font-medium tabular-nums">{formatEur(l.total)}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-3 border-t border-slate-200">
          <Row label="Subtotal líneas" value={subtotal} />
          <Row label="Total" value={ticket.total} strong />
          {ticket.payments.length > 0 && (
            <div className="mt-3 space-y-1.5 text-[13px]">
              {ticket.payments.map((p) => (
                <div key={p.id} className="flex justify-between text-slate-500">
                  <span>{p.method}</span>
                  <span className="tabular-nums">{formatEur(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {ticket.notes && (
          <div className="mt-4 bg-mipiace-stone rounded-xl p-3 text-[12.5px] text-slate-600">
            {ticket.notes}
          </div>
        )}
        {ticket.syncError != null && typeof ticket.syncError === "object" && (
          <div className="mt-4 bg-red-50 rounded-xl p-3 text-[12.5px] text-red-700">
            Error sync: {JSON.stringify(ticket.syncError)}
          </div>
        )}

        <div className="mt-5 space-y-2.5">
          <div>
            <label className="block text-[12.5px] text-slate-500 mb-1">Reenviar por email</label>
            <div className="flex gap-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="cliente@ejemplo.com"
                className="flex-1 h-10 px-3 rounded-xl bg-mipiace-stone border border-transparent text-[13px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
              />
              <button
                onClick={resend}
                disabled={!email || sending}
                className="h-10 px-3 rounded-xl bg-mipiace-coral text-white text-[13px] font-medium disabled:opacity-50 flex items-center gap-1.5"
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                Enviar
              </button>
            </div>
            {sendStatus && (
              <div className="text-[12px] text-slate-500 mt-1.5">{sendStatus}</div>
            )}
          </div>

          <div>
            <button
              onClick={reprint}
              disabled={!canReprint || reprinting}
              className="w-full h-11 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-[13.5px] font-medium text-mipiace-ink flex items-center justify-center gap-2"
            >
              {reprinting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Printer className="w-4 h-4" />
              )}
              Reimprimir {vocab("ticketNoun", businessType).toLowerCase()}
            </button>
            {reprintStatus && (
              <div className="text-[12px] text-slate-500 mt-1.5">{reprintStatus}</div>
            )}
          </div>

          {ticket.status === "SYNCED" && (
            <button
              onClick={onRefund}
              className="w-full h-11 rounded-xl border border-mipiace-coral/30 text-mipiace-coral-dark hover:bg-mipiace-coral-soft text-[13.5px] font-medium flex items-center justify-center gap-2"
            >
              {/* v1.3-Servicios-Pinta · Lote 5: en SERVICES (anulación)
                  XCircle comunica mejor "cancelar" que RotateCcw, que
                  semánticamente es "deshacer" (típico retail). */}
              {businessType === "SERVICES" ? (
                <XCircle className="w-4 h-4" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              Iniciar {vocab("refundNoun", businessType).toLowerCase()}
            </button>
          )}

          {ticket.holdedDocumentId && (
            <a
              href={`https://app.holded.com/documents/salesreceipt/${ticket.holdedDocumentId}`}
              target="_blank"
              rel="noreferrer noopener"
              className="w-full h-11 rounded-xl border border-slate-200 hover:bg-slate-50 text-[13.5px] font-medium text-slate-600 flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-4 h-4" /> Abrir en Holded
            </a>
          )}
        </div>
        <button
          onClick={onChanged}
          className="mt-5 w-full h-12 rounded-2xl bg-slate-900 hover:bg-mipiace-ink-soft text-white text-[14px] font-medium"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className={`flex justify-between text-[13.5px] ${strong ? "font-medium text-mipiace-ink" : "text-slate-500"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{formatEur(value)}</span>
    </div>
  );
}
