// Pantalla de reimpresión masiva de ticket regalo (B6 §5).
//
// La impresión real vive en el bloque dedicado posterior. Por ahora el
// propietario / encargado marca los tickets a reimprimir y el campo
// `giftReceiptIntentAt` queda persistido para cuando el agente local
// ESC/POS esté disponible.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckSquare, Gift, Square } from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens } from "../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  SuccessBanner,
} from "../ui.js";

interface GiftCandidate {
  id: string;
  internalNumber: string;
  createdAt: string;
  total: number;
  status: string;
  giftReceiptIntentAt: string | null;
  register: {
    id: string;
    name: string;
    storeId: string;
    storeName: string;
  };
  linesPreview: Array<{ name: string; units: number }>;
}

interface Store {
  id: string;
  name: string;
}

export function GiftReceiptsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<GiftCandidate[] | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [filterStoreId, setFilterStoreId] = useState<string>("");
  const [filterDaysBack, setFilterDaysBack] = useState<number>(30);
  const [filterMinTotal, setFilterMinTotal] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ stores: Store[] }>("/admin/stores")
      .then((res) => setStores(res.stores))
      .catch(() => {
        /* Sin stores el filtro queda en "Todas las tiendas". */
      });
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStoreId, filterDaysBack, filterMinTotal]);

  async function refresh() {
    setItems(null);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("daysBack", String(filterDaysBack));
      if (filterStoreId) params.set("storeId", filterStoreId);
      if (filterMinTotal && Number(filterMinTotal) > 0) {
        params.set("minTotal", filterMinTotal);
      }
      const res = await api<{ items: GiftCandidate[] }>(
        `/admin/tickets/gift-receipt-candidates?${params}`,
      );
      setItems(res.items);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearTokens();
        navigate("/login", { replace: true });
      } else if (err instanceof ApiError) {
        setError(err.message);
        setItems([]);
      }
    }
  }

  function toggle(id: string) {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!items) return;
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((it) => it.id)));
    }
  }

  async function onBatchMark() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api<{ updated: number; requested: number }>(
        "/admin/tickets/batch-gift-receipt",
        { method: "POST", body: { ticketIds: Array.from(selected) } },
      );
      setSuccess(
        `${res.updated} de ${res.requested} tickets marcados para reimpresión.`,
      );
      setSelected(new Set());
      refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  const allChecked = useMemo(
    () => !!items && items.length > 0 && selected.size === items.length,
    [items, selected],
  );

  return (
    <AdminShell title="Tickets regalo">
      <p className="text-[13.5px] text-slate-500 mb-3 -mt-2">
        Marca los tickets que quieras reimprimir como ticket regalo (rebajas,
        Navidad…). Quedan en cola para cuando el agente de impresión local
        esté disponible.
      </p>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-800 mb-5">
        La impresión física se hará desde el TPV cuando el bloque de impresión
        esté disponible. Aquí persistimos sólo la intención.
      </div>

      {success && <SuccessBanner message={success} />}
      {error && <FieldError message={error} />}

      <section className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-[12px] font-medium text-mipiace-ink-soft mb-1">
              Rango
            </span>
            <select
              value={filterDaysBack}
              onChange={(e) => setFilterDaysBack(Number(e.target.value))}
              className="w-full h-10 px-3 rounded-xl bg-mipiace-stone border border-transparent text-[13.5px] focus:bg-white focus:border-mipiace-coral/30 focus:outline-none"
            >
              <option value={7}>Últimos 7 días</option>
              <option value={30}>Últimos 30 días</option>
              <option value={60}>Últimos 60 días</option>
              <option value={90}>Últimos 90 días</option>
              <option value={180}>Últimos 6 meses</option>
              <option value={365}>Último año</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-mipiace-ink-soft mb-1">
              Tienda
            </span>
            <select
              value={filterStoreId}
              onChange={(e) => setFilterStoreId(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-mipiace-stone border border-transparent text-[13.5px] focus:bg-white focus:border-mipiace-coral/30 focus:outline-none"
            >
              <option value="">Todas</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-mipiace-ink-soft mb-1">
              Importe mínimo (€)
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={filterMinTotal}
              onChange={(e) => setFilterMinTotal(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-mipiace-stone border border-transparent text-[13.5px] tabular-nums focus:bg-white focus:border-mipiace-coral/30 focus:outline-none"
              placeholder="0"
            />
          </label>
        </div>
      </section>

      {items == null ? (
        <CenteredLoader label="Cargando tickets…" />
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <Gift className="w-8 h-8 text-slate-300 mx-auto mb-3" strokeWidth={1.6} />
          <p className="text-[14px] font-medium text-mipiace-ink">
            No hay tickets en este rango
          </p>
          <p className="text-[13px] text-slate-500 mt-1">
            Ajusta los filtros o amplía el rango de fechas.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={toggleAll}
              className="w-full flex items-center gap-3 px-5 py-3 border-b border-slate-100 hover:bg-slate-50 text-left"
            >
              {allChecked ? (
                <CheckSquare className="w-4 h-4 text-mipiace-coral" />
              ) : (
                <Square className="w-4 h-4 text-slate-400" />
              )}
              <span className="text-[13px] font-medium text-mipiace-ink">
                {allChecked ? "Deseleccionar todo" : "Seleccionar todo"}
                <span className="text-slate-400 ml-2 font-normal">
                  ({items.length}{" "}
                  {items.length === 1 ? "ticket" : "tickets"})
                </span>
              </span>
            </button>
            <ul>
              {items.map((it) => {
                const checked = selected.has(it.id);
                return (
                  <li
                    key={it.id}
                    className="px-5 py-3 border-b border-slate-100 last:border-0 flex items-center gap-3 hover:bg-slate-50"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(it.id)}
                      aria-label={
                        checked
                          ? `Deseleccionar ticket ${it.internalNumber}`
                          : `Seleccionar ticket ${it.internalNumber}`
                      }
                    >
                      {checked ? (
                        <CheckSquare className="w-4 h-4 text-mipiace-coral" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium text-mipiace-ink tabular-nums">
                        #{it.internalNumber}
                        <span className="text-slate-400 ml-2 font-normal">
                          {new Date(it.createdAt).toLocaleString("es-ES", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="text-[12px] text-slate-500 truncate">
                        {it.register.storeName} · {it.register.name} ·{" "}
                        {it.linesPreview
                          .map((l) => l.name)
                          .slice(0, 3)
                          .join(", ") || "—"}
                      </div>
                    </div>
                    <div className="text-[13px] tabular-nums text-mipiace-ink shrink-0">
                      {it.total.toFixed(2)} €
                    </div>
                    {it.giftReceiptIntentAt && (
                      <span
                        title={`Marcado el ${new Date(
                          it.giftReceiptIntentAt,
                        ).toLocaleString("es-ES")}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 text-[11px] font-medium shrink-0"
                      >
                        <Gift className="w-3 h-3" />
                        En cola
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {selected.size > 0 && (
            <div className="sticky bottom-4 mt-5 bg-mipiace-ink text-white rounded-2xl p-3 flex items-center gap-3 shadow-lg">
              <span className="text-[13.5px] font-medium px-2">
                {selected.size}{" "}
                {selected.size === 1 ? "seleccionado" : "seleccionados"}
              </span>
              <PrimaryButton
                type="button"
                onClick={onBatchMark}
                busy={busy}
                className="!w-auto !h-10 !px-4 !text-[13px] ml-auto"
              >
                Marcar para ticket regalo
              </PrimaryButton>
              <OutlineButton
                type="button"
                onClick={() => setSelected(new Set())}
                className="!h-10 !text-[13px] !text-white !border-white/20 hover:!bg-white/10"
              >
                Limpiar
              </OutlineButton>
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}
