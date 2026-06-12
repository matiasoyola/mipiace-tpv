// v1.5-consistencia-C · chip flotante de cobros pendientes de enviar.
//
// Nota de diseño: el chip "Pendientes" de SalePage es OTRA cosa
// (carritos aparcados) y SalePage pertenece a la rama paralela
// v1-0-pilotos, así que este indicador es independiente. Vive montado
// desde App.tsx para ser visible en cualquier pantalla del TPV.
//
// Sólo aparece cuando hay items en el outbox. Ámbar = pendientes de
// red (se subirán solos); rojo = rechazados por el servidor, que piden
// acción manual (reintentar o descartar).

import { useEffect, useState } from "react";
import { AlertTriangle, CloudOff, RotateCw, Trash2, X } from "lucide-react";

import {
  outboxCounts,
  outboxDelete,
  outboxList,
  outboxRetry,
  subscribeOutbox,
} from "../lib/outbox.js";
import type { OutboxItem } from "../lib/outbox.js";

const formatEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

export function OutboxChip() {
  const [counts, setCounts] = useState({ pending: 0, rejected: 0 });
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OutboxItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const c = await outboxCounts();
        if (cancelled) return;
        setCounts(c);
        if (c.pending + c.rejected === 0) setOpen(false);
      } catch {
        /* IndexedDB inaccesible — el chip simplemente no aparece */
      }
    }
    void refresh();
    const unsubscribe = subscribeOutbox(() => void refresh());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      try {
        const list = await outboxList();
        if (!cancelled) setItems(list);
      } catch {
        /* idem */
      }
    }
    void load();
    const unsubscribe = subscribeOutbox(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [open]);

  const total = counts.pending + counts.rejected;
  if (total === 0) return null;

  return (
    <>
      <button
        type="button"
        data-testid="outbox-chip"
        onClick={() => setOpen(true)}
        className={
          counts.rejected > 0
            ? "fixed bottom-3 right-3 z-40 h-10 px-3.5 rounded-full bg-red-600 text-white text-[12.5px] font-medium shadow-lg flex items-center gap-2"
            : "fixed bottom-3 right-3 z-40 h-10 px-3.5 rounded-full bg-amber-500 text-white text-[12.5px] font-medium shadow-lg flex items-center gap-2"
        }
      >
        {counts.rejected > 0 ? (
          <AlertTriangle className="w-4 h-4" />
        ) : (
          <CloudOff className="w-4 h-4" />
        )}
        {counts.rejected > 0
          ? `${counts.rejected} con error · ${counts.pending} por enviar`
          : `${counts.pending} por enviar`}
      </button>

      {open && (
        <div className="fixed inset-0 z-40 bg-mipiace-ink/60 flex items-end sm:items-center justify-center p-3 sm:p-5 font-sans">
          <div className="bg-white rounded-3xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
            <header className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
              <h2 className="text-[16px] font-semibold text-mipiace-ink">
                Cobros pendientes de enviar
              </h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="h-9 w-9 rounded-full bg-mipiace-stone text-slate-500 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5">
              {items.map((item) => (
                <OutboxItemRow key={item.externalId} item={item} />
              ))}
              {items.length === 0 && (
                <div className="text-[13px] text-slate-500 text-center py-6">
                  Nada pendiente.
                </div>
              )}
            </div>
            <footer className="px-5 py-3 border-t border-slate-100 text-[12px] text-slate-500">
              Los pendientes se reenvían solos al volver la conexión. Los
              rechazados necesitan revisión manual.
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function OutboxItemRow({ item }: { item: OutboxItem }) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const rejected = item.status === "rejected";
  return (
    <div
      data-testid="outbox-item"
      className={
        rejected
          ? "rounded-2xl border border-red-200 bg-red-50 p-3.5"
          : "rounded-2xl border border-amber-200 bg-amber-50 p-3.5"
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[13.5px] font-medium text-mipiace-ink">
          {item.label}
          <span className="text-slate-500 font-normal">
            {" "}
            · {formatTime(item.createdAt)}
          </span>
        </div>
        <div className="text-[13.5px] font-semibold tabular-nums text-mipiace-ink">
          {formatEur(item.total)}
        </div>
      </div>
      <div
        className={
          rejected
            ? "mt-1 text-[12px] text-red-700"
            : "mt-1 text-[12px] text-amber-700"
        }
      >
        {rejected
          ? `Rechazado por el servidor${item.lastError ? `: ${item.lastError}` : ""}`
          : "Pendiente de enviar — se reintenta automáticamente."}
      </div>
      {rejected && (
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={() => void outboxRetry(item.externalId)}
            className="h-9 px-3 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-[12.5px] font-medium text-mipiace-ink flex items-center gap-1.5"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Reintentar
          </button>
          {confirmDiscard ? (
            <button
              type="button"
              onClick={() => void outboxDelete(item.externalId)}
              className="h-9 px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[12.5px] font-medium flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              ¿Seguro? Descartar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDiscard(true)}
              className="h-9 px-3 rounded-xl bg-white border border-red-200 hover:bg-red-100 text-[12.5px] font-medium text-red-700 flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Descartar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
