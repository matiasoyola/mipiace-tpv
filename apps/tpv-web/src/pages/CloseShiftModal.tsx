// Modal de cierre de turno. Antes vivía inline en ShiftActiveScreen;
// B4 lo extrae para reutilizarlo desde SalePage cuando el cajero pulsa
// "Cerrar turno" en la pantalla de venta.

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { ApiError, apiWithCashier } from "../api.js";

interface FailedDoc {
  id: string;
  kind: "ticket" | "refund";
  internalNumber: string;
  total: number;
  createdAt: string;
  errorSummary: string;
}

export function CloseShiftModal({
  shiftId,
  cashierRole,
  onClose,
  onClosed,
}: {
  shiftId: string;
  cashierRole: "MANAGER" | "CASHIER";
  onClose: () => void;
  onClosed: () => void;
}) {
  const [cashCounted, setCashCounted] = useState("");
  const [syncFailureAccepted, setSyncFailureAccepted] = useState(false);
  const [managerPin, setManagerPin] = useState("");
  const [needsManager, setNeedsManager] = useState(false);
  const [pinReason, setPinReason] = useState<"sync_failed" | "force_close" | null>(null);
  const [failedDocs, setFailedDocs] = useState<FailedDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counted = parseFloat(cashCounted.replace(",", "."));
  const ready = !busy && !Number.isNaN(counted) && counted >= 0;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await apiWithCashier(`/shift/${shiftId}/close`, {
        method: "POST",
        body: {
          cashCounted: counted,
          methodTotals: {},
          syncFailureAccepted,
          managerPin: managerPin || undefined,
        },
      });
      onClosed();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "MANAGER_PIN_REQUIRED") {
          setNeedsManager(true);
          const reason = (err.data as { reason?: string } | undefined)?.reason;
          setPinReason(reason === "sync_failed" ? "sync_failed" : "force_close");
          setError(
            reason === "sync_failed"
              ? "Hay tickets rechazados por Holded. Pide al encargado que introduzca su PIN para cerrar el turno."
              : "Este cierre requiere PIN de encargado.",
          );
        } else if (err.code === "SYNC_PENDING") {
          const detail = err.data as
            | {
                failedTickets?: FailedDoc[];
                failedRefunds?: FailedDoc[];
              }
            | undefined;
          setFailedDocs([...(detail?.failedTickets ?? []), ...(detail?.failedRefunds ?? [])]);
          setError(
            "Hay tickets sin sincronizar. Marca el aviso para autorizar el cierre.",
          );
        } else {
          setError(err.message);
        }
      } else {
        setError("Error inesperado");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-center p-4 font-sans"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-3xl border border-slate-200 p-6 md:p-7"
      >
        <h2 className="text-[18px] font-semibold text-mipiace-ink mb-1">Cerrar turno</h2>
        <p className="text-[13px] text-slate-500 mb-5">
          Cuenta el efectivo del cajón y confírmalo. Generamos el informe Z y se archiva el turno.
        </p>
        <label className="block text-[13px] font-medium text-mipiace-ink mb-2">
          Efectivo contado
        </label>
        <input
          value={cashCounted}
          onChange={(e) => setCashCounted(e.target.value)}
          inputMode="decimal"
          placeholder="0,00"
          className="w-full h-14 mb-4 px-4 text-[20px] font-semibold tracking-tight bg-mipiace-stone border border-transparent rounded-2xl focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:bg-white tabular-nums text-right focus:outline-none"
        />

        {failedDocs.length > 0 && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-red-800 mb-2">
              <AlertCircle className="w-4 h-4" />
              {failedDocs.length} documento{failedDocs.length === 1 ? "" : "s"} rechazado{failedDocs.length === 1 ? "" : "s"} por Holded en este turno
            </div>
            <ul className="space-y-1.5 max-h-40 overflow-y-auto">
              {failedDocs.map((d) => (
                <li
                  key={`${d.kind}-${d.id}`}
                  className="flex items-center justify-between gap-2 text-[12.5px] text-red-900 bg-white/60 rounded-lg px-2.5 py-1.5"
                >
                  <span className="tabular-nums font-medium shrink-0">
                    {d.kind === "refund" ? "↩ " : ""}
                    {d.internalNumber}
                  </span>
                  <span className="truncate flex-1 text-red-700">{d.errorSummary}</span>
                  <span className="tabular-nums shrink-0">{d.total.toFixed(2)} €</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-red-700">
              Avisa al encargado. Si cierra, tendrá que introducir su PIN.
            </p>
          </div>
        )}

        <label htmlFor="syncFailureAccepted" className="flex items-start gap-2 text-[12.5px] text-slate-600 mb-4 cursor-pointer">
          <input
            id="syncFailureAccepted"
            name="syncFailureAccepted"
            type="checkbox"
            checked={syncFailureAccepted}
            onChange={(e) => setSyncFailureAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30"
          />
          <span>
            Autorizo el cierre aunque haya tickets sin sincronizar (la bandeja de errores los seguirá tratando).
          </span>
        </label>

        {(needsManager || cashierRole === "CASHIER" || pinReason === "sync_failed") && (
          <>
            <label htmlFor="managerPin" className="block text-[13px] font-medium text-mipiace-ink mb-2">
              {pinReason === "sync_failed"
                ? "PIN de encargado (requerido por tickets fallados)"
                : "PIN de encargado (si aplica)"}
            </label>
            <input
              id="managerPin"
              name="managerPin"
              value={managerPin}
              onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              placeholder="••••"
              className="w-full h-14 mb-4 px-4 text-[18px] font-semibold tracking-[0.3em] bg-mipiace-stone border border-transparent rounded-2xl focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:bg-white tabular-nums focus:outline-none"
            />
          </>
        )}

        <div className="flex gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 h-12 rounded-2xl border border-slate-200 hover:bg-slate-50 text-[13.5px] text-mipiace-ink-soft font-medium"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!ready}
            className="flex-1 h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Cerrar
          </button>
        </div>
        {error && (
          <div className="mt-4 flex items-start gap-2 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5">
            <AlertCircle className="w-4 h-4 mt-px shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
