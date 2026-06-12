// Modal de cierre de turno + arqueo X intermedio (v1.3-Thalia Lote 4).
//
// Hay dos modos según `mode`:
//   - "Z": cierre del turno. El cajero cuenta efectivo por
//     denominaciones; el total se calcula en el frontend para verlo y
//     se re-valida en backend. POST a `/shift/:id/cash-count` con
//     `kind: "Z"`. El backend persiste el ShiftCashCount Y dispara el
//     close atómicamente.
//   - "X": arqueo intermedio (no cierra turno). Misma tabla, pero el
//     POST lleva `kind: "X"`. Se muestra el descuadre vs cash esperado
//     que devuelve el backend (ventas en cash + opening float).
//
// El campo libre "Efectivo contado" del modal previo desaparece: ahora
// el total siempre proviene de la suma por denominación. Aviso visual
// fuerte si |descuadre| > 5€ cuando se cierra Z.

import { useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { ApiError, apiWithCashier } from "../api.js";

// Mismo orden que `ALLOWED_DENOMINATIONS` del backend (de mayor a
// menor). Si el backend cambia el set, también hay que tocarlo aquí —
// son 15 valores fijos del euro, no hay mantenimiento real.
const DENOMINATIONS: readonly { key: string; valueEur: number; label: string }[] = [
  { key: "500", valueEur: 500, label: "500 €" },
  { key: "200", valueEur: 200, label: "200 €" },
  { key: "100", valueEur: 100, label: "100 €" },
  { key: "50", valueEur: 50, label: "50 €" },
  { key: "20", valueEur: 20, label: "20 €" },
  { key: "10", valueEur: 10, label: "10 €" },
  { key: "5", valueEur: 5, label: "5 €" },
  { key: "2", valueEur: 2, label: "2 €" },
  { key: "1", valueEur: 1, label: "1 €" },
  { key: "0.50", valueEur: 0.5, label: "50 cts" },
  { key: "0.20", valueEur: 0.2, label: "20 cts" },
  { key: "0.10", valueEur: 0.1, label: "10 cts" },
  { key: "0.05", valueEur: 0.05, label: "5 cts" },
  { key: "0.02", valueEur: 0.02, label: "2 cts" },
  { key: "0.01", valueEur: 0.01, label: "1 ct" },
];

const formatEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

interface FailedDoc {
  id: string;
  kind: "ticket" | "refund";
  internalNumber: string;
  total: number;
  createdAt: string;
  errorSummary: string;
}

interface CashCountResponse {
  kind: "X" | "Z";
  cashCounted: number;
  cashTheoretical: number;
  descuadre: number;
  shift?: { id: string; closedAt: string; zReportPdfPath: string | null };
}

export function CloseShiftModal(props: {
  shiftId: string;
  cashierRole: "MANAGER" | "CASHIER";
  // "Z" (default) = cierre real. "X" = arqueo intermedio sin cerrar.
  mode?: "X" | "Z";
  onClose: () => void;
  onClosed: () => void;
}) {
  const mode = props.mode ?? "Z";
  // Estado: contador por denominación (entero >= 0). Vacío equivale a 0.
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [syncFailureAccepted, setSyncFailureAccepted] = useState(false);
  const [managerPin, setManagerPin] = useState("");
  const [needsManager, setNeedsManager] = useState(false);
  const [pinReason, setPinReason] = useState<"sync_failed" | "force_close" | null>(null);
  const [failedDocs, setFailedDocs] = useState<FailedDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resultado del POST X — para mostrar el descuadre sin cerrar.
  const [xResult, setXResult] = useState<CashCountResponse | null>(null);

  // Suma local para feedback inmediato del cajero. El total
  // autoritativo lo calcula el backend (ese va al ShiftCashCount).
  // Mantenemos céntimos para evitar el clásico 0.1+0.2=0.30000004.
  const totalEur = useMemo(() => {
    let cents = 0;
    for (const d of DENOMINATIONS) {
      const n = parseInt(counts[d.key] ?? "", 10);
      if (Number.isFinite(n) && n > 0) {
        cents += Math.round(d.valueEur * 100) * n;
      }
    }
    return cents / 100;
  }, [counts]);

  function setCount(key: string, raw: string): void {
    // Sólo dígitos. Vacío permitido para que el cajero pueda borrar.
    const cleaned = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    setCounts((curr) => ({ ...curr, [key]: cleaned }));
  }

  function buildDenominationsPayload(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const d of DENOMINATIONS) {
      const n = parseInt(counts[d.key] ?? "", 10);
      if (Number.isFinite(n) && n > 0) out[d.key] = n;
    }
    return out;
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiWithCashier<CashCountResponse>(
        `/shift/${props.shiftId}/cash-count`,
        {
          method: "POST",
          body: {
            kind: mode,
            denominations: buildDenominationsPayload(),
            syncFailureAccepted: mode === "Z" ? syncFailureAccepted : undefined,
            managerPin: mode === "Z" && managerPin ? managerPin : undefined,
          },
        },
      );
      if (mode === "X") {
        setXResult(res);
      } else {
        props.onClosed();
      }
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
            | { failedTickets?: FailedDoc[]; failedRefunds?: FailedDoc[] }
            | undefined;
          setFailedDocs([
            ...(detail?.failedTickets ?? []),
            ...(detail?.failedRefunds ?? []),
          ]);
          // v1.5-B §3.c: mismo copy que la pantalla de turno colgado
          // (ShiftForceCloseScreen, v1.5-hotfix2) — cerrar no es un
          // problema, sólo requiere aceptación explícita.
          setError(
            "Hay tickets sin sincronizar con Holded. Puedes cerrar el turno igualmente: las ventas no se ven afectadas y los tickets pendientes se recuperarán automáticamente. Marca el aviso para confirmar.",
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

  const isZ = mode === "Z";
  // Aviso visual fuerte si el descuadre del X (cuando se mostró) o
  // del Z previsualizado supera 5€ en valor absoluto. Se decide al
  // confirmar el Z basándose en lo que devuelva el backend; aquí lo
  // pintamos para el X que YA tiene resultado.
  const showXDescuadreAlert =
    xResult && Math.abs(xResult.descuadre) > 5;

  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/40 flex items-end sm:items-center justify-center p-4 font-sans"
      onClick={props.onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-lg rounded-3xl border border-slate-200 p-6 md:p-7 max-h-[95vh] overflow-y-auto"
      >
        <h2 className="text-[18px] font-semibold text-mipiace-ink mb-1">
          {isZ ? "Cerrar turno · arqueo Z" : "Arqueo X (control)"}
        </h2>
        <p className="text-[13px] text-slate-500 mb-4">
          {isZ
            ? "Cuenta el efectivo del cajón por denominaciones. Generamos el informe Z y se archiva el turno."
            : "Cuenta el efectivo del cajón sin cerrar el turno. Útil para arqueos intermedios."}
        </p>

        {xResult ? (
          <XResultPanel result={xResult} alert={showXDescuadreAlert ?? false} />
        ) : (
          <>
            <div className="rounded-2xl border border-slate-200 overflow-hidden mb-4">
              <table className="w-full text-[13.5px]">
                <thead className="bg-mipiace-stone text-slate-500 text-[12px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left py-2 px-3 font-medium">Denominación</th>
                    <th className="text-center py-2 px-2 font-medium w-20">Cant.</th>
                    <th className="text-right py-2 px-3 font-medium w-28">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {DENOMINATIONS.map((d) => {
                    const n = parseInt(counts[d.key] ?? "", 10);
                    const subtotal =
                      Number.isFinite(n) && n > 0 ? d.valueEur * n : 0;
                    return (
                      <tr key={d.key} className="hover:bg-slate-50">
                        <td className="py-1.5 px-3 text-mipiace-ink">{d.label}</td>
                        <td className="py-1.5 px-2">
                          <input
                            value={counts[d.key] ?? ""}
                            onChange={(e) => setCount(d.key, e.target.value)}
                            onFocus={(e) => e.target.select()}
                            inputMode="numeric"
                            placeholder="0"
                            className="w-full h-9 px-2 text-center tabular-nums bg-mipiace-stone border border-transparent rounded-lg focus:bg-white focus:border-mipiace-coral/30 focus:ring-1 focus:ring-mipiace-coral/40 focus:outline-none"
                          />
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums text-slate-500">
                          {subtotal > 0 ? formatEur(subtotal) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-mipiace-stone">
                  <tr>
                    <td colSpan={2} className="py-2.5 px-3 text-[13px] font-medium text-mipiace-ink">
                      Total contado
                    </td>
                    <td className="py-2.5 px-3 text-right text-[15px] font-semibold tabular-nums text-mipiace-ink">
                      {formatEur(totalEur)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {isZ && failedDocs.length > 0 && (
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

            {isZ && (
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
                  Lo entiendo, cerrar el turno igualmente. Las ventas no se ven
                  afectadas y los tickets pendientes se recuperarán
                  automáticamente.
                </span>
              </label>
            )}

            {isZ && (needsManager || props.cashierRole === "CASHIER" || pinReason === "sync_failed") && (
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
          </>
        )}

        <div className="flex gap-2.5 pt-1">
          <button
            type="button"
            onClick={props.onClose}
            disabled={busy}
            className="flex-1 h-12 rounded-2xl border border-slate-200 hover:bg-slate-50 text-[13.5px] text-mipiace-ink-soft font-medium"
          >
            {xResult ? "Cerrar" : "Cancelar"}
          </button>
          {!xResult && (
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="flex-1 h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {isZ ? "Cerrar turno" : "Guardar arqueo X"}
            </button>
          )}
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

function XResultPanel({
  result,
  alert,
}: {
  result: CashCountResponse;
  alert: boolean;
}) {
  return (
    <div className="rounded-2xl bg-mipiace-stone p-4 mb-4">
      <div className="text-[12px] uppercase tracking-wider text-slate-500 mb-2">
        Resultado del arqueo
      </div>
      <div className="space-y-1.5 text-[14px]">
        <div className="flex justify-between">
          <span className="text-slate-500">Cash esperado</span>
          <span className="tabular-nums text-mipiace-ink">
            {formatEur(result.cashTheoretical)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Cash contado</span>
          <span className="tabular-nums text-mipiace-ink">
            {formatEur(result.cashCounted)}
          </span>
        </div>
        <div
          className={
            "flex justify-between pt-2 border-t border-slate-200 font-medium " +
            (alert ? "text-red-700" : "text-mipiace-ink")
          }
        >
          <span>Descuadre</span>
          <span className="tabular-nums">
            {result.descuadre >= 0 ? "+" : ""}
            {formatEur(result.descuadre)}
          </span>
        </div>
      </div>
      {alert && (
        <div className="mt-3 text-[12.5px] text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Descuadre &gt; 5 €. Recuento de control sugerido antes de cerrar Z.
        </div>
      )}
    </div>
  );
}
