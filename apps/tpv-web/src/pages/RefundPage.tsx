// Overlay de devolución (B4 §5.1). Selecciona líneas + unidades a
// devolver, elige método de reembolso (por defecto el del cobro
// original), confirma → POST /refunds.

import { useMemo, useState } from "react";
import { ArrowLeft, Loader2, Minus, Plus } from "lucide-react";

import { ApiError, apiWithCashier } from "../api.js";

const formatEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

interface OriginalLine {
  id: string;
  nameSnapshot: string;
  units: number;
  total: number;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
}

interface OriginalPayment {
  id: string;
  method: string;
  amount: number;
}

interface OriginalTicket {
  id: string;
  internalNumber: string;
  total: number;
  lines: OriginalLine[];
  payments: OriginalPayment[];
}

interface RefundResponse {
  refund: {
    id: string;
    internalNumber: string;
    status: string;
    total: number;
  };
}

export function RefundOverlay(props: {
  ticket: OriginalTicket;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [unitsByLine, setUnitsByLine] = useState<Record<string, number>>(() =>
    Object.fromEntries(props.ticket.lines.map((l) => [l.id, 0])),
  );
  const defaultMethod = props.ticket.payments[0]?.method ?? "CASH";
  const [method, setMethod] = useState<string>(defaultMethod);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setUnits(lineId: string, value: number, max: number) {
    setUnitsByLine((curr) => ({
      ...curr,
      [lineId]: Math.max(0, Math.min(max, value)),
    }));
  }

  const refundTotal = useMemo(() => {
    let total = 0;
    for (const l of props.ticket.lines) {
      const refundUnits = unitsByLine[l.id] ?? 0;
      if (refundUnits <= 0) continue;
      const grossPerUnit = l.unitPrice * (1 - l.discountPct / 100);
      const lineTotal = grossPerUnit * refundUnits * (1 + l.taxRate / 100);
      total += lineTotal;
    }
    return Math.round(total * 100) / 100;
  }, [unitsByLine, props.ticket.lines]);

  const valid = Object.values(unitsByLine).some((u) => u > 0);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const payloadLines = Object.entries(unitsByLine)
        .filter(([, u]) => u > 0)
        .map(([ticketLineId, units]) => ({ ticketLineId, units }));
      await apiWithCashier<RefundResponse>("/refunds", {
        method: "POST",
        body: {
          externalId: crypto.randomUUID(),
          originalTicketId: props.ticket.id,
          method,
          reason: reason || undefined,
          lines: payloadLines,
        },
      });
      props.onConfirmed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-mipiace-ink/95 flex flex-col font-sans">
      <header className="h-[88px] border-b border-slate-200 bg-white flex items-center px-5 md:px-8 gap-3">
        <button
          onClick={props.onClose}
          className="h-10 w-10 rounded-xl hover:bg-slate-50 text-slate-600 flex items-center justify-center"
          aria-label="Volver"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2.1} />
        </button>
        <h1 className="text-[20px] font-semibold text-mipiace-ink tracking-tight">
          Devolución · ticket #{props.ticket.internalNumber}
        </h1>
      </header>
      <main className="flex-1 overflow-y-auto bg-mipiace-stone p-5 md:p-8">
        <div className="max-w-4xl mx-auto grid lg:grid-cols-[1fr_360px] gap-5">
          <section className="bg-white rounded-3xl border border-slate-200 p-5">
            <h2 className="text-[16px] font-semibold text-mipiace-ink mb-1">
              Líneas a devolver
            </h2>
            <p className="text-[12.5px] text-slate-500 mb-4">
              Selecciona cuántas unidades de cada línea quieres devolver.
            </p>
            <div className="space-y-3">
              {props.ticket.lines.map((l) => (
                <div key={l.id} className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] text-mipiace-ink font-medium truncate">
                      {l.nameSnapshot}
                    </div>
                    <div className="text-[12.5px] text-slate-500 tabular-nums">
                      {l.units} ud. · {formatEur(l.unitPrice)} ud.
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setUnits(l.id, (unitsByLine[l.id] ?? 0) - 1, l.units)}
                      className="h-10 w-10 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-slate-600 flex items-center justify-center"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      value={unitsByLine[l.id] ?? 0}
                      onChange={(e) =>
                        setUnits(l.id, Number(e.target.value) || 0, l.units)
                      }
                      inputMode="numeric"
                      className="w-14 h-10 px-2 rounded-xl bg-mipiace-stone border border-transparent text-[14px] font-semibold text-center tabular-nums focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
                    />
                    <button
                      onClick={() => setUnits(l.id, (unitsByLine[l.id] ?? 0) + 1, l.units)}
                      className="h-10 w-10 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-slate-600 flex items-center justify-center"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <label className="block text-[13px] font-medium text-mipiace-ink mb-2">
                Motivo (opcional)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="w-full px-3.5 py-2.5 rounded-xl bg-mipiace-stone border border-transparent text-[13px] focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
              />
            </div>
          </section>
          <aside className="bg-white rounded-3xl border border-slate-200 p-5 flex flex-col">
            <h2 className="text-[16px] font-semibold text-mipiace-ink mb-1">Método de reembolso</h2>
            <p className="text-[12.5px] text-slate-500 mb-3">
              Por defecto, mismo método del cobro original.
            </p>
            <div className="grid grid-cols-2 gap-2 mb-5">
              {["CASH", "CARD", "BIZUM", "VOUCHER"].map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={
                    m === method
                      ? "h-12 rounded-2xl border-2 border-mipiace-coral bg-mipiace-coral-soft text-mipiace-coral-dark font-medium text-[13px]"
                      : "h-12 rounded-2xl border border-slate-200 hover:border-slate-300 bg-white text-mipiace-ink font-medium text-[13px]"
                  }
                >
                  {labelFor(m)}
                </button>
              ))}
            </div>
            <div className="bg-mipiace-stone rounded-xl p-4 mb-5">
              <div className="text-[12px] uppercase tracking-wider text-slate-400 mb-1">
                Total a reembolsar
              </div>
              <div className="text-[28px] font-semibold tabular-nums text-mipiace-ink">
                {formatEur(refundTotal)}
              </div>
            </div>
            {error && (
              <div className="text-[12.5px] text-red-700 bg-red-50 rounded-xl p-3 mb-3">
                {error}
              </div>
            )}
            <button
              onClick={submit}
              disabled={!valid || submitting}
              className="mt-auto h-14 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[15px] font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirmar devolución
            </button>
          </aside>
        </div>
      </main>
    </div>
  );
}

function labelFor(m: string): string {
  if (m === "CASH") return "Efectivo";
  if (m === "CARD") return "Tarjeta";
  if (m === "BIZUM") return "Bizum";
  if (m === "VOUCHER") return "Vale";
  return m;
}
