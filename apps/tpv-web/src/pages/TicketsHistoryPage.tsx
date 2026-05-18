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
} from "lucide-react";

import { ApiError, apiWithCashier } from "../api.js";
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
    | "VOIDED";
  total: number;
  totalTax: number;
  totalDiscount: number;
  holdedDocumentId: string | null;
  holdedDocNumber: string | null;
  contactHoldedId: string | null;
  emailIntent: string | null;
  notes: string | null;
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
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");
  const [selected, setSelected] = useState<TicketRow | null>(null);
  const [refunding, setRefunding] = useState<TicketRow | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q.trim());
      if (status) params.set("status", status);
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
  }, [q, status]);

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
          Tickets
        </h1>
        <div className="flex-1 max-w-xl ml-auto">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
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
            No hay tickets que coincidan.
          </div>
        ) : (
          <ul className="space-y-2.5">
            {tickets.map((t) => (
              <TicketRowCard
                key={t.id}
                ticket={t}
                onOpen={() => setSelected(t)}
              />
            ))}
          </ul>
        )}
      </main>

      {selected && (
        <TicketDetailDrawer
          ticket={selected}
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

function TicketRowCard({ ticket, onOpen }: { ticket: TicketRow; onOpen: () => void }) {
  return (
    <li>
      <button
        onClick={onOpen}
        className="w-full bg-white rounded-2xl border border-slate-200 hover:border-mipiace-coral/40 p-4 flex items-center gap-4 text-left"
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
          </div>
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
        <ChevronRight className="w-4 h-4 text-slate-300" />
      </button>
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
  };
  const { color, label } = map[status];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-medium uppercase tracking-wider ${color}`}
    >
      {label}
    </span>
  );
}

function TicketDetailDrawer({
  ticket,
  onClose,
  onRefund,
  onChanged,
}: {
  ticket: TicketRow;
  onClose: () => void;
  onRefund: () => void;
  onChanged: () => void;
}) {
  const [email, setEmail] = useState(ticket.emailIntent ?? "");
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);

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

          <button
            onClick={() => alert("Impresión real ESC/POS llega en B5.")}
            className="w-full h-11 rounded-xl border border-slate-200 hover:bg-slate-50 text-[13.5px] font-medium text-mipiace-ink flex items-center justify-center gap-2"
          >
            <Printer className="w-4 h-4" /> Reimprimir ticket
          </button>

          {ticket.status === "SYNCED" && (
            <button
              onClick={onRefund}
              className="w-full h-11 rounded-xl border border-mipiace-coral/30 text-mipiace-coral-dark hover:bg-mipiace-coral-soft text-[13.5px] font-medium flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" /> Iniciar devolución
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
