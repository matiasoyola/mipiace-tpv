// Placeholder de "turno abierto" — la pantalla de venta llega en B4. En
// B3 sólo mostramos contexto + posibilidad de cerrar el turno y de
// volver a PIN (cerrar sesión cajero sin tocar turno).

import { useState } from "react";
import { AlertCircle, Loader2, ShoppingBag } from "lucide-react";

import { apiWithCashier, ApiError } from "../api.js";
import { Logo } from "../Logo.js";

export function ShiftActiveScreen({
  shiftId,
  cashOpening,
  openedAt,
  cashierLabel,
  cashierRole,
  registerName,
  storeName,
  autoLogoutMinutes,
  onClosed,
  onLogoutCashier,
}: {
  shiftId: string;
  cashOpening: string;
  openedAt: string;
  cashierLabel: string;
  cashierRole: "MANAGER" | "CASHIER";
  registerName: string;
  storeName: string;
  autoLogoutMinutes: number;
  onClosed: () => void;
  onLogoutCashier: () => void;
}) {
  const [showClose, setShowClose] = useState(false);
  return (
    <div className="min-h-screen bg-mipiace-stone flex flex-col font-sans">
      <header className="h-[72px] md:h-[88px] border-b border-slate-200 flex items-center justify-between px-5 md:px-7 bg-white">
        <Logo size={26} />
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[12.5px] text-slate-500">{cashierLabel}</div>
            <div className="text-[11.5px] text-slate-400">
              Auto-logout: {autoLogoutMinutes} min
            </div>
          </div>
          <button
            onClick={onLogoutCashier}
            className="h-9 px-3 rounded-lg hover:bg-slate-50 text-[13px] text-slate-600 font-medium"
          >
            Bloquear
          </button>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center p-5">
        <div className="w-full max-w-lg bg-white rounded-3xl border border-slate-200 p-8 text-center">
          <div className="h-14 w-14 mx-auto rounded-2xl bg-mipiace-coral-soft text-mipiace-coral flex items-center justify-center mb-4">
            <ShoppingBag className="w-7 h-7" strokeWidth={1.6} />
          </div>
          <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight mb-2">
            Turno abierto
          </h1>
          <p className="text-[14px] text-slate-500 leading-relaxed mb-6">
            La pantalla de venta llega en B4. Mientras tanto, este turno
            está registrado y el auto-logout protege la sesión cuando dejes
            la tablet sola.
          </p>
          <div className="bg-mipiace-stone rounded-xl p-4 text-left space-y-1 text-[12.5px] text-slate-600 mb-6">
            <div>
              Caja:{" "}
              <span className="text-mipiace-ink font-medium">
                {registerName} · {storeName}
              </span>
            </div>
            <div>
              Apertura:{" "}
              <span className="text-mipiace-ink font-medium tabular-nums">
                {new Date(openedAt).toLocaleString("es-ES")}
              </span>
            </div>
            <div>
              Fondo inicial:{" "}
              <span className="text-mipiace-ink font-medium tabular-nums">
                {cashOpening} €
              </span>
            </div>
          </div>
          <button
            onClick={() => setShowClose(true)}
            className="w-full h-12 rounded-2xl border border-mipiace-coral/30 text-mipiace-coral-dark hover:bg-mipiace-coral-soft text-[13.5px] font-medium"
          >
            Cerrar turno
          </button>
        </div>
      </main>

      {showClose && (
        <CloseShiftModal
          shiftId={shiftId}
          cashierRole={cashierRole}
          onClose={() => setShowClose(false)}
          onClosed={onClosed}
        />
      )}
    </div>
  );
}

function CloseShiftModal({
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
        <h2 className="text-[18px] font-semibold text-mipiace-ink mb-1">
          Cerrar turno
        </h2>
        <p className="text-[13px] text-slate-500 mb-5">
          Cuenta el efectivo del cajón y confírmalo. Generamos el informe Z
          y se archiva el turno.
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
            Autorizo el cierre aunque haya tickets sin sincronizar (la
            bandeja de errores los seguirá tratando).
          </span>
        </label>

        {(needsManager || cashierRole === "CASHIER") && (
          <>
            <label className="block text-[13px] font-medium text-mipiace-ink mb-2">
              PIN de encargado (si aplica)
            </label>
            <input
              value={managerPin}
              onChange={(e) =>
                setManagerPin(e.target.value.replace(/\D/g, "").slice(0, 8))
              }
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
