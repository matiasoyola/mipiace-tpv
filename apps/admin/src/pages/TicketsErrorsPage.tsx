// Bandeja `SYNC_FAILED` (B5 §2.2). Una tabla combinada tickets+refunds
// con drawer detalle (payload original, syncError, líneas) y acciones:
// reintentar, marcar resuelto, editar SKU. Filtros básicos por fecha,
// tienda, caja, tipo de error.

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ChevronRight,
  CircleCheck,
  ExternalLink,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError } from "../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  TextField,
  formatRelative,
} from "../ui.js";

interface SyncErrorEntry {
  id: string;
  kind: "ticket" | "refund";
  internalNumber: string;
  externalId: string;
  createdAt: string;
  total: number;
  lineCount: number;
  errorSummary: string;
  errorType: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  holdedDocumentId: string | null;
  holdedDocNumber: string | null;
  register: {
    id: string;
    name: string;
    storeId: string;
    storeName: string;
  } | null;
  originalTicket?: { id: string; internalNumber: string } | null;
}

interface SyncErrorListResponse {
  items: SyncErrorEntry[];
  pendingCount: number;
}

interface TicketDetail {
  id: string;
  internalNumber: string;
  externalId: string;
  status: string;
  total: number;
  totalTax: number;
  totalDiscount: number;
  notes: string | null;
  contactHoldedId: string | null;
  holdedDocumentId: string | null;
  holdedDocNumber: string | null;
  syncError: unknown;
  createdAt: string;
  syncedAt: string | null;
  lines: Array<{
    id: string;
    sku: string;
    nameSnapshot: string;
    units: number;
    unitPrice: number;
    discountPct: number;
    taxRate: number;
    total: number;
  }>;
  payments: Array<{ id: string; method: string; amount: number }>;
}

interface RefundDetail {
  id: string;
  internalNumber: string;
  externalId: string;
  status: string;
  total: number;
  totalTax: number;
  reason: string | null;
  method: string | null;
  holdedDocumentId: string | null;
  holdedDocNumber: string | null;
  createdAt: string;
  syncedAt: string | null;
  lines: Array<{
    id: string;
    sku: string;
    nameSnapshot: string;
    units: number;
    unitPrice: number;
    discountPct: number;
    taxRate: number;
    total: number;
  }>;
}

interface Filters {
  from: string;
  to: string;
  registerId: string;
  storeId: string;
  errorType: string;
}

const EMPTY_FILTERS: Filters = {
  from: "",
  to: "",
  registerId: "",
  storeId: "",
  errorType: "",
};

const ERROR_TYPES: Array<{ value: string; label: string }> = [
  { value: "", label: "Todos los errores" },
  { value: "silent_reject", label: "Silent reject (POST)" },
  { value: "pay_silent_reject", label: "Silent reject (/pay)" },
  { value: "holded_4xx", label: "Error HTTP (POST)" },
  { value: "pay_4xx", label: "Error HTTP (/pay)" },
  { value: "no_holded_key", label: "Sin API Key" },
];

interface MeTenant {
  tenant: {
    lastIncrementalSyncAt: string | null;
    hasHoldedKey: boolean;
  };
}

interface TenantHealth {
  level: "ok" | "warning" | "blocked";
  reason: string;
  hoursSinceSync: number | null;
}

function computeTenantHealth(tenant: MeTenant["tenant"]): TenantHealth {
  if (!tenant.hasHoldedKey) {
    return { level: "blocked", reason: "no_api_key", hoursSinceSync: null };
  }
  if (!tenant.lastIncrementalSyncAt) {
    return { level: "warning", reason: "no_sync_ever", hoursSinceSync: null };
  }
  const ageMs = Date.now() - new Date(tenant.lastIncrementalSyncAt).getTime();
  const hours = ageMs / 3_600_000;
  if (hours >= 48) {
    return { level: "blocked", reason: "no_sync_48h", hoursSinceSync: hours };
  }
  if (hours >= 24) {
    return { level: "warning", reason: "no_sync_24h", hoursSinceSync: hours };
  }
  return { level: "ok", reason: "ok", hoursSinceSync: hours };
}

function HealthBanner({
  tenant,
}: {
  tenant: MeTenant["tenant"];
}) {
  const health = computeTenantHealth(tenant);
  if (health.level === "ok") return null;
  const isBlocked = health.level === "blocked";
  const title = isBlocked
    ? "TPV bloqueado · Holded no responde"
    : "Sincronización pendiente";
  const desc =
    health.reason === "no_api_key"
      ? "La API Key de Holded no está configurada. Conéctala en Mi cuenta para reanudar la operativa."
      : health.reason === "no_sync_ever"
      ? "Todavía no hemos completado el primer sync incremental. Espera unos minutos o revisa el sync inicial."
      : `Llevamos ${health.hoursSinceSync?.toFixed(0)} h sin contacto con Holded. Prueba la conexión en Mi cuenta o contacta soporte.`;
  return (
    <div
      className={
        isBlocked
          ? "mb-5 flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3"
          : "mb-5 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3"
      }
    >
      <AlertCircle
        className={isBlocked ? "w-4 h-4 mt-0.5 text-red-600" : "w-4 h-4 mt-0.5 text-amber-700"}
      />
      <div className="flex-1 min-w-0">
        <div
          className={
            isBlocked
              ? "text-[13.5px] font-semibold text-red-800"
              : "text-[13.5px] font-semibold text-amber-800"
          }
        >
          {title}
        </div>
        <div
          className={
            isBlocked ? "text-[12.5px] text-red-700 mt-0.5" : "text-[12.5px] text-amber-700 mt-0.5"
          }
        >
          {desc}
        </div>
      </div>
      <a
        href="/admin/account"
        className={
          isBlocked
            ? "shrink-0 h-9 inline-flex items-center px-3 rounded-lg bg-white border border-red-200 text-[12.5px] font-medium text-red-700 hover:bg-red-50"
            : "shrink-0 h-9 inline-flex items-center px-3 rounded-lg bg-white border border-amber-200 text-[12.5px] font-medium text-amber-800 hover:bg-amber-50"
        }
      >
        Probar conexión
      </a>
    </div>
  );
}

export function TicketsErrorsPage() {
  const [items, setItems] = useState<SyncErrorEntry[] | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<SyncErrorEntry | null>(null);
  const [me, setMe] = useState<MeTenant | null>(null);

  useEffect(() => {
    api<MeTenant>("/auth/me").then(setMe).catch(() => {
      /* Si /auth/me falla, no pintamos banner. */
    });
  }, []);

  const load = useCallback(async (f: Filters) => {
    const qs = new URLSearchParams();
    if (f.from) qs.set("from", f.from);
    if (f.to) qs.set("to", f.to);
    if (f.registerId) qs.set("registerId", f.registerId);
    if (f.storeId) qs.set("storeId", f.storeId);
    if (f.errorType) qs.set("errorType", f.errorType);
    qs.set("limit", "100");
    setError(null);
    try {
      const res = await api<SyncErrorListResponse>(
        `/admin/tickets/sync-errors?${qs.toString()}`,
      );
      setItems(res.items);
      setPendingCount(res.pendingCount);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else throw err;
    }
  }, []);

  useEffect(() => {
    load(filters);
  }, [filters, load]);

  return (
    <AdminShell title="Sincronización con Holded">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        Tickets y devoluciones que Holded rechazó. Reintenta automáticamente
        cuando hayas resuelto la causa (e.g. corregir SKU, contactar a soporte
        Holded). Hasta entonces, el ticket sigue cobrado en el TPV.
      </p>

      {me && <HealthBanner tenant={me.tenant} />}

      {pendingCount > 0 && (
        <div className="mb-5 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-[13.5px] text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <strong className="font-semibold">
              {pendingCount} documento{pendingCount === 1 ? "" : "s"}
            </strong>{" "}
            pendiente{pendingCount === 1 ? "" : "s"} de sincronización. Revisa
            cada caso y reintenta o marca como resuelto manualmente.
          </span>
        </div>
      )}

      <FiltersBar filters={filters} setFilters={setFilters} />

      {error && <FieldError message={error} />}

      {!items ? (
        <CenteredLoader label="Cargando bandeja…" />
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <TicketsTable items={items} onSelect={setSelected} />
      )}

      {selected && (
        <DetailDrawer
          entry={selected}
          onClose={() => setSelected(null)}
          onActionComplete={() => {
            setSelected(null);
            load(filters);
          }}
        />
      )}
    </AdminShell>
  );
}

function FiltersBar({
  filters,
  setFilters,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-5 flex flex-wrap gap-3">
      <label className="flex-1 min-w-[140px]">
        <span className="block text-[11.5px] uppercase tracking-wider text-slate-400 font-medium mb-1">
          Desde
        </span>
        <input
          id="filter-from"
          name="from"
          type="date"
          value={filters.from.slice(0, 10)}
          onChange={(e) =>
            setFilters({
              ...filters,
              from: e.target.value ? `${e.target.value}T00:00:00.000Z` : "",
            })
          }
          className="w-full h-10 px-3 rounded-xl bg-mipiace-stone border border-transparent text-[13.5px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
        />
      </label>
      <label className="flex-1 min-w-[140px]">
        <span className="block text-[11.5px] uppercase tracking-wider text-slate-400 font-medium mb-1">
          Hasta
        </span>
        <input
          id="filter-to"
          name="to"
          type="date"
          value={filters.to.slice(0, 10)}
          onChange={(e) =>
            setFilters({
              ...filters,
              to: e.target.value ? `${e.target.value}T23:59:59.999Z` : "",
            })
          }
          className="w-full h-10 px-3 rounded-xl bg-mipiace-stone border border-transparent text-[13.5px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
        />
      </label>
      <label className="flex-1 min-w-[200px]">
        <span className="block text-[11.5px] uppercase tracking-wider text-slate-400 font-medium mb-1">
          Tipo de error
        </span>
        <select
          id="filter-error-type"
          name="errorType"
          value={filters.errorType}
          onChange={(e) => setFilters({ ...filters, errorType: e.target.value })}
          className="w-full h-10 px-3 rounded-xl bg-mipiace-stone border border-transparent text-[13.5px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
        >
          {ERROR_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
      <div className="h-12 w-12 mx-auto rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-3">
        <CircleCheck className="w-6 h-6" />
      </div>
      <h2 className="text-[16px] font-semibold text-mipiace-ink">
        Todo en orden
      </h2>
      <p className="text-[13.5px] text-slate-500 mt-1 max-w-md mx-auto">
        No hay tickets ni devoluciones pendientes de sincronización con Holded.
      </p>
    </div>
  );
}

function TicketsTable({
  items,
  onSelect,
}: {
  items: SyncErrorEntry[];
  onSelect: (e: SyncErrorEntry) => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <table className="w-full text-[13.5px]">
        <thead className="bg-mipiace-stone/40">
          <tr className="text-left text-[12px] uppercase tracking-wider text-slate-500 font-medium">
            <th className="px-4 py-2.5">Tipo</th>
            <th className="px-4 py-2.5">Nº interno</th>
            <th className="px-4 py-2.5">Fecha</th>
            <th className="px-4 py-2.5">Caja</th>
            <th className="px-4 py-2.5 text-right">Total</th>
            <th className="px-4 py-2.5">Error</th>
            <th className="px-4 py-2.5 text-center">Intentos</th>
            <th className="px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr
              key={`${it.kind}-${it.id}`}
              onClick={() => onSelect(it)}
              className="border-t border-slate-100 cursor-pointer hover:bg-mipiace-stone/30 transition-colors"
            >
              <td className="px-4 py-3">
                <KindBadge kind={it.kind} />
              </td>
              <td className="px-4 py-3 font-medium text-mipiace-ink tabular-nums">
                {it.internalNumber}
              </td>
              <td className="px-4 py-3 text-slate-500">
                {formatRelative(it.createdAt)}
              </td>
              <td className="px-4 py-3 text-slate-600 truncate max-w-[180px]">
                {it.register ? `${it.register.storeName} · ${it.register.name}` : "—"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-mipiace-ink">
                {it.total.toFixed(2)} €
              </td>
              <td className="px-4 py-3 text-red-700 truncate max-w-[260px]">
                {it.errorSummary}
              </td>
              <td className="px-4 py-3 text-center tabular-nums">
                {it.attempts > 0 ? (
                  <span
                    className={
                      it.attempts >= 3
                        ? "inline-flex items-center px-2 py-0.5 rounded-lg bg-amber-50 text-amber-700 text-[11.5px] font-medium"
                        : "text-slate-500"
                    }
                  >
                    {it.attempts}
                  </span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-400">
                <ChevronRight className="w-4 h-4" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KindBadge({ kind }: { kind: "ticket" | "refund" }) {
  if (kind === "refund") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-rose-50 text-rose-700 text-[11.5px] font-medium">
        Devolución
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-sky-50 text-sky-700 text-[11.5px] font-medium">
      Ticket
    </span>
  );
}

function DetailDrawer({
  entry,
  onClose,
  onActionComplete,
}: {
  entry: SyncErrorEntry;
  onClose: () => void;
  onActionComplete: () => void;
}) {
  const [detail, setDetail] = useState<TicketDetail | RefundDetail | null>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editLineId, setEditLineId] = useState<string | null>(null);
  const [editSku, setEditSku] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveDocId, setResolveDocId] = useState("");
  const [resolveDocNumber, setResolveDocNumber] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const path =
          entry.kind === "ticket"
            ? `/tickets/${entry.id}`
            : `/admin/refunds/${entry.id}/holded-payload-preview`;
        // Ticket: ya hay endpoint público de detalle. Refund: usamos
        // el preview, que carga las líneas implícitamente vía la query
        // del backend (re-usamos lo que hay).
        if (entry.kind === "ticket") {
          const t = await api<{ ticket: TicketDetail }>(path);
          if (!cancelled) setDetail(t.ticket);
        } else {
          // Para refunds, el detalle viene del payload preview + la
          // entrada de la lista. Construimos un detalle mínimo a mano.
          const minimal: RefundDetail = {
            id: entry.id,
            internalNumber: entry.internalNumber,
            externalId: entry.externalId,
            status: "SYNC_FAILED",
            total: entry.total,
            totalTax: 0,
            reason: null,
            method: null,
            holdedDocumentId: entry.holdedDocumentId,
            holdedDocNumber: entry.holdedDocNumber,
            createdAt: entry.createdAt,
            syncedAt: null,
            lines: [],
          };
          if (!cancelled) setDetail(minimal);
        }
        const previewPath =
          entry.kind === "ticket"
            ? `/admin/tickets/${entry.id}/holded-payload-preview`
            : `/admin/refunds/${entry.id}/holded-payload-preview`;
        const p = await api<{ payload: unknown }>(previewPath);
        if (!cancelled) setPayload(p.payload);
      } catch (err) {
        if (err instanceof ApiError && !cancelled) setError(err.message);
        else if (!cancelled) throw err;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry]);

  async function onRetry() {
    setBusy(true);
    setError(null);
    try {
      const path =
        entry.kind === "ticket"
          ? `/admin/tickets/${entry.id}/retry-sync`
          : `/admin/refunds/${entry.id}/retry-sync`;
      await api(path, { method: "POST", body: {} });
      onActionComplete();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  async function onMarkResolved() {
    if (!resolveDocId.trim()) {
      setError("Indica el documentId de Holded para marcar como resuelto.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path =
        entry.kind === "ticket"
          ? `/admin/tickets/${entry.id}/mark-resolved`
          : `/admin/refunds/${entry.id}/mark-resolved`;
      await api(path, {
        method: "POST",
        body: {
          holdedDocumentId: resolveDocId.trim(),
          ...(resolveDocNumber.trim() ? { holdedDocNumber: resolveDocNumber.trim() } : {}),
        },
      });
      onActionComplete();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEditSku() {
    if (!editLineId || !editSku.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const path =
        entry.kind === "ticket"
          ? `/admin/tickets/${entry.id}/edit-line-sku`
          : `/admin/refunds/${entry.id}/edit-line-sku`;
      const body =
        entry.kind === "ticket"
          ? { ticketLineId: editLineId, sku: editSku.trim() }
          : { refundLineId: editLineId, sku: editSku.trim() };
      await api(path, { method: "POST", body });
      onActionComplete();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  const syncErrorObj = detail
    ? (detail as { syncError?: unknown }).syncError
    : null;

  return (
    <div
      className="fixed inset-0 z-40 bg-mipiace-ink/40 flex justify-end"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white h-full overflow-y-auto"
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <KindBadge kind={entry.kind} />
              <span className="text-[16px] font-semibold text-mipiace-ink tabular-nums">
                {entry.internalNumber}
              </span>
            </div>
            <div className="text-[12.5px] text-slate-500">
              {formatRelative(entry.createdAt)} · {entry.register?.storeName ?? "—"}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="h-9 w-9 rounded-xl hover:bg-slate-50 text-slate-500 flex items-center justify-center"
          >
            <X className="w-4 h-4" strokeWidth={2.25} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Resumen del error */}
          <section>
            <h3 className="text-[11.5px] uppercase tracking-wider text-slate-400 font-medium mb-2">
              Error de sincronización
            </h3>
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-[13px] text-red-800">
              <div className="font-medium">{entry.errorSummary}</div>
              {syncErrorObj != null && (
                <pre className="mt-2 text-[12px] text-red-900 whitespace-pre-wrap break-words bg-white/60 rounded-xl p-3 border border-red-100">
                  {JSON.stringify(syncErrorObj, null, 2)}
                </pre>
              )}
            </div>
          </section>

          {/* Acciones */}
          <section>
            <h3 className="text-[11.5px] uppercase tracking-wider text-slate-400 font-medium mb-2">
              Acciones
            </h3>
            <div className="flex flex-wrap gap-2.5">
              <OutlineButton onClick={onRetry} busy={busy} disabled={resolving}>
                <RotateCcw className="w-3.5 h-3.5" />
                Reintentar
              </OutlineButton>
              <OutlineButton
                onClick={() => setResolving((r) => !r)}
                disabled={busy}
              >
                <CircleCheck className="w-3.5 h-3.5" />
                {resolving ? "Cancelar marcado" : "Marcar resuelto"}
              </OutlineButton>
              {entry.holdedDocumentId && (
                <a
                  href={`https://app.holded.com/documents/${entry.holdedDocumentId}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="h-11 px-4 rounded-2xl border border-slate-200 hover:bg-slate-50 text-[13.5px] text-mipiace-ink-soft font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Ver en Holded
                </a>
              )}
            </div>
            {resolving && (
              <div className="mt-3 bg-mipiace-stone/40 rounded-2xl p-4 space-y-3">
                <p className="text-[12.5px] text-slate-500">
                  Si el documento ya existe en Holded (lo viste manualmente en
                  el panel) pero nuestro GET-back no lo detectó, pega aquí su
                  ID y, opcionalmente, el docNumber.
                </p>
                <TextField
                  id="resolve-doc-id"
                  label="Holded documentId"
                  value={resolveDocId}
                  onChange={setResolveDocId}
                  required
                />
                <TextField
                  id="resolve-doc-number"
                  label="docNumber (opcional)"
                  value={resolveDocNumber}
                  onChange={setResolveDocNumber}
                />
                <PrimaryButton type="button" onClick={onMarkResolved} busy={busy}>
                  Confirmar resolución
                </PrimaryButton>
              </div>
            )}
          </section>

          {/* Líneas del documento (sólo tickets, los refunds no las
              traemos en este endpoint para reducir scope; el preview
              del payload muestra exactamente lo que se envía). */}
          {detail && "lines" in detail && detail.lines.length > 0 && (
            <section>
              <h3 className="text-[11.5px] uppercase tracking-wider text-slate-400 font-medium mb-2">
                Líneas
              </h3>
              <div className="bg-mipiace-stone/40 rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead className="text-[11.5px] uppercase tracking-wider text-slate-400 font-medium">
                    <tr className="text-left">
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2 text-right">Uds</th>
                      <th className="px-3 py-2 text-right">Precio</th>
                      <th className="px-3 py-2 text-right">IVA</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l) => (
                      <tr key={l.id} className="border-t border-slate-200">
                        <td className="px-3 py-2 truncate max-w-[200px] text-mipiace-ink">
                          {l.nameSnapshot}
                        </td>
                        <td className="px-3 py-2 text-slate-500 tabular-nums">
                          {l.sku || <span className="text-red-700">·sin SKU·</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.units}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.unitPrice.toFixed(2)} €
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.taxRate}%
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.total.toFixed(2)} €
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => {
                              setEditLineId(l.id);
                              setEditSku(l.sku);
                            }}
                            className="h-7 w-7 rounded-lg hover:bg-white text-slate-500 flex items-center justify-center"
                            aria-label="Editar SKU"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {editLineId && (
                <div className="mt-3 bg-mipiace-stone/40 rounded-2xl p-4 space-y-3">
                  <TextField
                    id="edit-sku"
                    label="Nuevo SKU para la línea"
                    value={editSku}
                    onChange={setEditSku}
                    required
                  />
                  <div className="flex gap-2.5">
                    <PrimaryButton type="button" onClick={onSaveEditSku} busy={busy}>
                      Guardar y reintentar
                    </PrimaryButton>
                    <OutlineButton
                      onClick={() => {
                        setEditLineId(null);
                        setEditSku("");
                      }}
                    >
                      Cancelar
                    </OutlineButton>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Payload preview */}
          {payload != null && (
            <section>
              <h3 className="text-[11.5px] uppercase tracking-wider text-slate-400 font-medium mb-2">
                Payload que se enviará en el próximo intento
              </h3>
              <pre className="bg-mipiace-stone/40 rounded-2xl p-4 text-[12px] text-slate-700 overflow-x-auto whitespace-pre">
                {JSON.stringify(payload, null, 2)}
              </pre>
            </section>
          )}

          <FieldError message={error} />
        </div>
      </div>
    </div>
  );
}

