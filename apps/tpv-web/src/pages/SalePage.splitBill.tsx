// v1.4-Bar-Operativa-MVP Lote 4 · sheet de partir cuenta (Modo A).
//
// Sólo disponible cuando hay tableContext (los DRAFT con tableId son
// el contexto natural para partir importes). Permite registrar
// cobros parciales sobre el ticket DRAFT y muestra cuánto ya se ha
// cobrado vs cuánto resta. Al volver al CheckoutOverlay, el cajero
// introduce el importe restante como pago final.
//
// MVP intencionado: no integramos con CheckoutOverlay todavía. El
// cajero hace los partials, los ve listados, y cuando llega al
// remaining = 0 cierra el ticket por el flujo normal. Mejora futura:
// CheckoutOverlay descuenta los partials del display y los incluye
// en payments[] al confirmar.

import { useCallback, useEffect, useState } from "react";

import { apiWithCashier, ApiError } from "../api.js";

type Method = "CASH" | "CARD" | "BIZUM" | "VOUCHER";

const METHOD_LABEL: Record<Method, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  BIZUM: "Bizum",
  VOUCHER: "Vale",
};

interface PartialRow {
  id: string;
  amount: number;
  method: Method | "OTHER";
  cashAmount: number | null;
  paidAt: string;
}

interface TicketGetResponse {
  ticket: {
    id: string;
    total: number;
    partialPayments: PartialRow[];
  };
}

interface PartialPaymentResponse {
  partialId: string;
  total: number;
  collected: number;
  remaining: number;
  readyToClose: boolean;
}

export interface SplitBillSheetProps {
  ticketId: string;
  onClose: () => void;
}

export function SplitBillSheet({ ticketId, onClose }: SplitBillSheetProps) {
  const [total, setTotal] = useState<number | null>(null);
  const [partials, setPartials] = useState<PartialRow[]>([]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("CASH");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiWithCashier<TicketGetResponse>(
        `/tickets/${ticketId}`,
      );
      setTotal(res.ticket.total);
      setPartials(res.ticket.partialPayments ?? []);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError) setLoadError(err.message);
      else setLoadError("No se pudo cargar el ticket.");
    }
  }, [ticketId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const collected = partials.reduce((acc, p) => acc + p.amount, 0);
  const remaining = total != null ? Math.max(0, total - collected) : 0;

  function applyShortcut(divisor: 2 | 3 | 4) {
    if (total == null) return;
    const v = remaining / divisor;
    setAmount(v.toFixed(2));
  }

  async function submitPartial() {
    const parsed = parseFloat(amount.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Importe inválido.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiWithCashier<PartialPaymentResponse>(
        `/tickets/${ticketId}/partial-payment`,
        { method: "POST", body: { amount: parsed, method } },
      );
      setAmount("");
      // El backend devuelve el nuevo estado consolidado — refrescamos
      // partials del ticket completo para tener la fila nueva con su
      // paidAt server-side.
      await refresh();
      // Si el partial cierra la cuenta, sugerimos volver a Cobrar.
      if (res.readyToClose) {
        setError(null);
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("No se pudo registrar el cobro parcial.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-mipiace-ink/70 flex items-center justify-center p-4 font-sans"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-md w-full max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 md:px-6 pt-5 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-[18px] font-semibold text-mipiace-ink tracking-tight">
              Partir cuenta
            </h2>
            <p className="text-[12.5px] text-slate-500 mt-0.5">
              Cobra un importe parcial. El resto se cobra al final por
              el flujo normal.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] text-slate-500 hover:text-mipiace-ink"
          >
            Cerrar
          </button>
        </div>

        <div className="px-5 md:px-6 py-4 border-b border-slate-100 bg-mipiace-stone">
          {total == null ? (
            <div className="text-[13px] text-slate-500">Cargando…</div>
          ) : (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-400">
                  Total
                </div>
                <div className="text-[16px] font-semibold tabular-nums text-mipiace-ink">
                  {total.toFixed(2)} €
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-400">
                  Cobrado
                </div>
                <div className="text-[16px] font-semibold tabular-nums text-emerald-700">
                  {collected.toFixed(2)} €
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-400">
                  Resta
                </div>
                <div className="text-[16px] font-semibold tabular-nums text-mipiace-coral-dark">
                  {remaining.toFixed(2)} €
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 md:px-6 py-4">
          {loadError && (
            <div className="text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5 mb-3">
              {loadError}
            </div>
          )}

          {remaining > 0 && total != null && (
            <>
              <label className="block text-[13px] font-medium text-mipiace-ink mb-2">
                Importe del cobro
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                className="w-full h-14 px-4 text-[22px] font-semibold bg-mipiace-stone border border-transparent rounded-2xl focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:bg-white tabular-nums text-right focus:outline-none mb-3"
              />
              <div className="grid grid-cols-4 gap-2 mb-4">
                <button
                  onClick={() => setAmount(remaining.toFixed(2))}
                  className="h-10 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[12.5px] font-medium text-mipiace-ink"
                  title={`Importe restante (${remaining.toFixed(2)} €)`}
                >
                  Resto
                </button>
                <button
                  onClick={() => applyShortcut(2)}
                  className="h-10 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[12.5px] font-medium text-mipiace-ink"
                  title="La mitad del pendiente"
                >
                  ½
                </button>
                <button
                  onClick={() => applyShortcut(3)}
                  className="h-10 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[12.5px] font-medium text-mipiace-ink"
                  title="Un tercio del pendiente"
                >
                  ⅓
                </button>
                <button
                  onClick={() => applyShortcut(4)}
                  className="h-10 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[12.5px] font-medium text-mipiace-ink"
                  title="Un cuarto del pendiente"
                >
                  ¼
                </button>
              </div>

              <label className="block text-[13px] font-medium text-mipiace-ink mb-2">
                Método
              </label>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {(["CASH", "CARD", "BIZUM", "VOUCHER"] as Method[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={
                      m === method
                        ? "h-11 rounded-xl bg-mipiace-coral text-white text-[13.5px] font-medium"
                        : "h-11 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[13.5px] font-medium text-mipiace-ink"
                    }
                  >
                    {METHOD_LABEL[m]}
                  </button>
                ))}
              </div>

              {error && (
                <div className="text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5 mb-3">
                  {error}
                </div>
              )}

              <button
                onClick={() => void submitPartial()}
                disabled={busy || amount.trim() === ""}
                className="w-full h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark disabled:opacity-50 text-white text-[14.5px] font-medium"
              >
                {busy ? "Registrando…" : "Registrar cobro parcial"}
              </button>
            </>
          )}

          {remaining === 0 && total != null && total > 0 && (
            <div className="text-center py-5">
              <div className="text-[14px] font-semibold text-emerald-700 mb-1">
                Ticket totalmente cobrado entre los parciales.
              </div>
              <div className="text-[12.5px] text-slate-500">
                Cierra esta ventana y pulsa "Cobrar" para finalizar el
                ticket. Cobra el importe pendiente como 0 € o usa los
                pagos guardados.
              </div>
            </div>
          )}

          {partials.length > 0 && (
            <div className="mt-5">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium mb-2">
                Cobros registrados ({partials.length})
              </div>
              <div className="space-y-1.5">
                {partials.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between px-3 py-2 rounded-xl bg-mipiace-stone text-[13px]"
                  >
                    <div className="text-mipiace-ink">
                      <span className="font-semibold tabular-nums">
                        {p.amount.toFixed(2)} €
                      </span>
                      <span className="text-slate-500 ml-2">
                        {METHOD_LABEL[p.method as Method] ?? p.method}
                      </span>
                    </div>
                    <div className="text-[11.5px] text-slate-400 tabular-nums">
                      {new Date(p.paidAt).toLocaleTimeString("es-ES", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
