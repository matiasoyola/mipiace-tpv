// Cierre forzado de turno colgado del día anterior (B3 §3.5). El cajero
// actual debe cerrarlo antes de abrir uno nuevo. Si el actual no es
// MANAGER, exige PIN de encargado.

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { apiWithCashier, ApiError } from "../api.js";
import { Logo } from "../Logo.js";

interface ForceCloseShift {
  id: string;
  openedAt: string;
  lastActivityAt: string;
  cashOpening: string;
}

// Subconjunto de la respuesta 409 SYNC_PENDING del close (B5 §2.3).
// Misma forma que en CloseShiftModal.
interface FailedDoc {
  id: string;
  kind: "ticket" | "refund";
  internalNumber: string;
  total: number;
  createdAt: string;
  errorSummary: string;
}

export function ShiftForceCloseScreen({
  shift,
  cashierRole,
  onClosed,
}: {
  shift: ForceCloseShift;
  cashierRole: "MANAGER" | "CASHIER";
  onClosed: () => void;
}) {
  const [cashCounted, setCashCounted] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsManagerPin, setNeedsManagerPin] = useState(false);
  // v1.5-hotfix2 · SYNC_PENDING dejaba esta pantalla en bucle: la API
  // pide reenvío con `syncFailureAccepted: true` (igual que el
  // CloseShiftModal de B5 §2.3), pero aquí nunca se mandaba ni se
  // mostraba la lista. Visto el 2026-06-11 en Peluquería Sole: turno
  // colgado + 1 ticket SYNC_FAILED = imposible abrir caja.
  const [failedDocs, setFailedDocs] = useState<FailedDoc[] | null>(null);
  const [syncFailureAccepted, setSyncFailureAccepted] = useState(false);

  const counted = parseFloat(cashCounted.replace(",", "."));
  const ready =
    !busy &&
    !Number.isNaN(counted) &&
    counted >= 0 &&
    (failedDocs === null || syncFailureAccepted);

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await apiWithCashier(`/shift/${shift.id}/close`, {
        method: "POST",
        body: {
          cashCounted: counted,
          methodTotals: {},
          managerPin: managerPin || undefined,
          syncFailureAccepted: syncFailureAccepted || undefined,
        },
      });
      onClosed();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "MANAGER_PIN_REQUIRED") {
          setNeedsManagerPin(true);
          setError("Este cierre requiere PIN del cajero o del encargado.");
        } else if (err.code === "INVALID_MANAGER_PIN") {
          setError("PIN de encargado incorrecto.");
        } else if (err.code === "SYNC_PENDING") {
          const detail = err.data as
            | { failedTickets?: FailedDoc[]; failedRefunds?: FailedDoc[] }
            | undefined;
          setFailedDocs([
            ...(detail?.failedTickets ?? []),
            ...(detail?.failedRefunds ?? []),
          ]);
          setError(null);
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
    <div className="min-h-screen bg-mipiace-stone flex items-center justify-center p-5 font-sans">
      <div className="w-full max-w-lg">
        <div className="flex justify-center mb-7">
          <Logo size={32} />
        </div>
        <div className="bg-white rounded-3xl border border-slate-200 p-7 md:p-9">
          <div className="flex items-center gap-2 text-amber-700 text-[12.5px] font-medium mb-2">
            <AlertCircle className="w-3.5 h-3.5" />
            Turno colgado del día anterior
          </div>
          <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight mb-1.5">
            Hay un turno por cerrar
          </h1>
          <p className="text-[14px] text-slate-500 mb-6 leading-relaxed">
            El último turno de esta caja no se cerró ayer. Antes de abrir uno
            nuevo, cuenta el efectivo del cajón y ciérralo. El descuadre se
            calculará y guardará en el informe Z.
          </p>

          <div className="bg-mipiace-stone rounded-xl p-4 mb-6 space-y-1 text-[12.5px] text-slate-600">
            <div>
              Apertura:{" "}
              <span className="text-mipiace-ink font-medium tabular-nums">
                {new Date(shift.openedAt).toLocaleString("es-ES")}
              </span>
            </div>
            <div>
              Última actividad:{" "}
              <span className="text-mipiace-ink font-medium tabular-nums">
                {new Date(shift.lastActivityAt).toLocaleString("es-ES")}
              </span>
            </div>
            <div>
              Fondo inicial:{" "}
              <span className="text-mipiace-ink font-medium tabular-nums">
                {shift.cashOpening} €
              </span>
            </div>
          </div>

          <label className="block text-[13px] font-medium text-mipiace-ink mb-2">
            Efectivo contado al cierre
          </label>
          <div className="relative mb-5">
            <input
              value={cashCounted}
              onChange={(e) => setCashCounted(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              className="w-full h-14 pr-12 px-4 text-[22px] font-semibold tracking-tight bg-mipiace-stone border border-transparent rounded-2xl focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:bg-white tabular-nums text-right focus:outline-none"
            />
            <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[18px] font-semibold text-slate-400">
              €
            </span>
          </div>

          {failedDocs !== null && (
            <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-start gap-2 text-[13px] text-amber-800 mb-3">
                <AlertCircle className="w-4 h-4 mt-px shrink-0" />
                <span>
                  Hay {failedDocs.length === 0 ? "tickets" : failedDocs.length}{" "}
                  {failedDocs.length === 1 ? "ticket pendiente" : "tickets pendientes"} de
                  sincronizar con Holded. <strong>Puedes cerrar el turno igualmente</strong>:
                  las ventas de hoy no se ven afectadas y los tickets pendientes se
                  recuperarán automáticamente.
                </span>
              </div>
              {failedDocs.length > 0 && (
                <ul className="mb-3 space-y-1 text-[12.5px] text-amber-900 tabular-nums">
                  {failedDocs.map((d) => (
                    <li key={d.id} className="flex justify-between gap-3">
                      <span>
                        {d.kind === "refund" ? "Devolución" : "Ticket"} #{d.internalNumber}
                        {d.errorSummary ? ` · ${d.errorSummary}` : ""}
                      </span>
                      <span className="font-medium shrink-0">{d.total.toFixed(2)} €</span>
                    </li>
                  ))}
                </ul>
              )}
              <label className="flex items-start gap-2.5 text-[13px] text-amber-900 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={syncFailureAccepted}
                  onChange={(e) => setSyncFailureAccepted(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-amber-600"
                />
                <span>Lo entiendo, cerrar el turno igualmente.</span>
              </label>
            </div>
          )}

          {(needsManagerPin || cashierRole === "CASHIER") && (
            <>
              <label className="block text-[13px] font-medium text-mipiace-ink mb-2">
                PIN de encargado
              </label>
              <input
                value={managerPin}
                onChange={(e) =>
                  setManagerPin(e.target.value.replace(/\D/g, "").slice(0, 8))
                }
                inputMode="numeric"
                placeholder="••••"
                className="w-full h-14 mb-5 px-4 text-[20px] font-semibold tracking-[0.3em] bg-mipiace-stone border border-transparent rounded-2xl focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:bg-white tabular-nums focus:outline-none"
              />
            </>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={!ready}
            className="w-full h-14 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[15px] rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Cerrar turno colgado
          </button>
          {error && (
            <div className="mt-4 flex items-start gap-2 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5">
              <AlertCircle className="w-4 h-4 mt-px shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
