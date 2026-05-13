// Modal de cierre de turno. Antes vivía inline en ShiftActiveScreen;
// B4 lo extrae para reutilizarlo desde SalePage cuando el cajero pulsa
// "Cerrar turno" en la pantalla de venta.

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { ApiError, apiWithCashier } from "../api.js";

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
          setError("Este cierre requiere PIN de encargado.");
        } else if (err.code === "SYNC_PENDING") {
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

        <label className="flex items-start gap-2 text-[12.5px] text-slate-600 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={syncFailureAccepted}
            onChange={(e) => setSyncFailureAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-mipiace-coral focus:ring-mipiace-coral/30"
          />
          <span>
            Autorizo el cierre aunque haya tickets sin sincronizar (la bandeja de errores los seguirá tratando).
          </span>
        </label>

        {(needsManager || cashierRole === "CASHIER") && (
          <>
            <label className="block text-[13px] font-medium text-mipiace-ink mb-2">
              PIN de encargado (si aplica)
            </label>
            <input
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
