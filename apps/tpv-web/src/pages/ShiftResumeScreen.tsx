// v1.11-cierre-de-dia · la pantalla de la mañana. Antes se llamaba
// `ShiftForceCloseScreen` y era un portazo.
//
// El hallazgo (BD de producción, 2026-08-20): los quince últimos turnos de
// Peluquería Sole se cierran entre 1 y 4 segundos antes de abrirse el
// siguiente. Los quince. Sole llega, intenta abrir caja, se encuentra este
// muro, y hace el arqueo de ayer de pie —15 denominaciones— antes de su
// primera clienta. Dos meses así.
//
// Lo que cambia:
//   - "Reanudar turno" es la acción PRIMARIA. El cajero puede vender antes
//     de arquear, siempre. Esto solo ya le devuelve a Sole su primera
//     clienta, y es la parte que va primera si el bloque se parte.
//   - "Cerrar el día de ayer y abrir uno nuevo" es la secundaria, y lleva
//     a la tarjeta de resumen, no a la tabla de denominaciones.
//   - El campo "efectivo contado" a pelo que había aquí desaparece: era
//     incoherente con el cierre del menú (que sí desglosa) y bloqueaba el
//     botón hasta teclear algo. Los dos caminos terminan ahora en la misma
//     tarjeta — addendum del bloque, punto 2.
//
// Nota: esta pantalla sólo aparece con red. Sin red, `deriveOfflineShiftState`
// resuelve siempre a "reanudar" (v1.10), que es justo lo que este bloque
// convierte en el default también online.

import { useState } from "react";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";

import { apiWithCashier, ApiError } from "../api.js";
import { Logo } from "../Logo.js";
import { CloseShiftModal } from "./CloseShiftModal.js";

interface StaleShift {
  id: string;
  openedAt: string;
  lastActivityAt: string;
  cashOpening: string;
}

export interface ResumedShift {
  id: string;
  openedAt: string;
  cashOpening: string;
}

export function ShiftResumeScreen({
  shift,
  cashierRole,
  requireCashCountOnClose = false,
  onResumed,
  onClosed,
}: {
  shift: StaleShift;
  cashierRole: "MANAGER" | "CASHIER";
  // Si el negocio exige arqueo, el cierre entra directo por la tabla de
  // denominaciones en vez de por la tarjeta de resumen.
  requireCashCountOnClose?: boolean;
  onResumed: (shift: ResumedShift) => void;
  onClosed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  async function resume() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const fallback: ResumedShift = {
      id: shift.id,
      openedAt: shift.openedAt,
      cashOpening: shift.cashOpening,
    };
    try {
      const res = await apiWithCashier<{ shift: ResumedShift }>(
        `/shift/${shift.id}/resume`,
        { method: "POST", body: {} },
      );
      onResumed(res.shift);
    } catch (err) {
      // El turno ya no existe o lo cerró el corte de día mientras el
      // cajero miraba la pantalla: no hay nada que reanudar.
      if (
        err instanceof ApiError &&
        (err.code === "SHIFT_ALREADY_CLOSED" || err.code === "SHIFT_NOT_FOUND")
      ) {
        setBusy(false);
        onClosed();
        return;
      }
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        setError(err.message);
        setBusy(false);
        return;
      }
      // Se cayó la red al pulsar. Reanudar es sólo refrescar la marca de
      // actividad — no vamos a dejar al cajero sin caja por eso: entramos
      // igual y las ventas van al outbox como en v1.10.
      onResumed(fallback);
    } finally {
      setBusy(false);
    }
  }

  const openedAt = new Date(shift.openedAt);
  const lastActivityAt = new Date(shift.lastActivityAt);

  return (
    <div className="min-h-screen bg-mipiace-stone flex items-center justify-center p-5 font-sans">
      <div className="w-full max-w-lg">
        <div className="flex justify-center mb-7">
          <Logo size={32} />
        </div>
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-9">
          <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight mb-1.5">
            Tienes el turno de ayer abierto
          </h1>
          <p className="text-[14px] text-slate-500 mb-6 leading-relaxed">
            Puedes seguir vendiendo ahora mismo y cuadrar la caja cuando te
            venga bien. No hace falta contar nada para empezar el día.
          </p>

          <div className="bg-mipiace-stone rounded-xl p-4 mb-6 space-y-1 text-[12.5px] text-slate-600">
            <div>
              Apertura:{" "}
              <span className="text-mipiace-ink font-medium tabular-nums">
                {openedAt.toLocaleString("es-ES")}
              </span>
            </div>
            <div>
              Última venta:{" "}
              <span className="text-mipiace-ink font-medium tabular-nums">
                {lastActivityAt.toLocaleString("es-ES")}
              </span>
            </div>
            <div>
              Fondo inicial:{" "}
              <span className="text-mipiace-ink font-medium tabular-nums">
                {shift.cashOpening} €
              </span>
            </div>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5">
              <AlertCircle className="w-4 h-4 mt-px shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Acción primaria: seguir vendiendo. */}
          <button
            type="button"
            onClick={resume}
            disabled={busy}
            className="w-full h-14 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[15px] rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Reanudar turno
            {!busy && <ArrowRight className="w-4 h-4" />}
          </button>

          {/* Secundaria: cerrar el día de ayer. Termina en la tarjeta de
              resumen, igual que el cierre del menú. */}
          <button
            type="button"
            onClick={() => setClosing(true)}
            disabled={busy}
            className="mt-2.5 w-full min-h-[52px] rounded-2xl border border-slate-200 hover:bg-slate-50 text-[14px] text-mipiace-ink-soft font-medium disabled:opacity-50 px-4 py-3"
          >
            Cerrar el día de ayer y abrir uno nuevo
          </button>
        </div>
      </div>

      {closing && (
        <CloseShiftModal
          shiftId={shift.id}
          cashierRole={cashierRole}
          requireCashCountOnClose={requireCashCountOnClose}
          onClose={() => setClosing(false)}
          onClosed={onClosed}
        />
      )}
    </div>
  );
}
