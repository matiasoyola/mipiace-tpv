// Pantalla 3 del reference (TpvShiftOpenScreen). Fondo de caja inicial
// con quick keys.

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { apiWithCashier, ApiError } from "../api.js";
import { Logo } from "../Logo.js";

interface ShiftOpenResponse {
  shift: { id: string; openedAt: string; cashOpening: string };
}

export function ShiftOpenScreen({
  cashierEmail,
  registerName,
  storeName,
  onOpened,
  onBack,
}: {
  cashierEmail: string;
  registerName: string;
  storeName: string;
  onOpened: (shift: { id: string; openedAt: string; cashOpening: string }) => void;
  onBack: () => void;
}) {
  const [amount, setAmount] = useState<string>("0,00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseFloat(amount.replace(",", "."));
  const ready = !Number.isNaN(parsed) && parsed >= 0 && !busy;

  async function onSubmit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiWithCashier<ShiftOpenResponse>("/shift/open", {
        method: "POST",
        body: { cashOpening: parsed },
      });
      onOpened(res.shift);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
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
          <div className="flex items-center gap-3 mb-1">
            <span className="h-11 w-11 rounded-xl bg-mipiace-coral text-white text-[15px] font-semibold flex items-center justify-center">
              {initials(cashierEmail)}
            </span>
            <div>
              <div className="text-[15px] font-medium text-mipiace-ink truncate max-w-[260px]">
                {cashierEmail}
              </div>
              <div className="text-[12.5px] text-slate-500">
                {registerName} · {storeName}
              </div>
            </div>
          </div>
          <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight mt-6 mb-1.5">
            Abrir turno
          </h1>
          <p className="text-[14px] text-slate-500 mb-6 leading-relaxed">
            Cuenta el efectivo del cajón antes de empezar el turno y anótalo
            aquí. Aparecerá como fondo inicial en el arqueo de cierre.
          </p>
          <label htmlFor="cashOpening" className="block text-[13px] font-medium text-mipiace-ink mb-2">
            Fondo de caja inicial
          </label>
          <div className="relative mb-6">
            <input
              id="cashOpening"
              name="cashOpening"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="w-full h-16 pr-12 px-4 text-[26px] font-semibold tracking-tight bg-mipiace-stone border border-transparent rounded-2xl focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:bg-white tabular-nums text-right focus:outline-none"
            />
            <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[20px] font-semibold text-slate-400">
              €
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-7">
            {["50,00", "100,00", "150,00", "200,00"].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(v)}
                className="h-11 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[13px] font-medium text-mipiace-ink tabular-nums"
              >
                {v} €
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!ready}
            className="w-full h-14 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[15px] rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Abrir turno
          </button>
          {error && (
            <div className="mt-4 flex items-start gap-2 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5">
              <AlertCircle className="w-4 h-4 mt-px shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <button
            type="button"
            onClick={onBack}
            className="w-full mt-3 h-12 text-[13.5px] text-slate-500 hover:text-mipiace-ink font-medium"
          >
            Volver a selección de cajero
          </button>
        </div>
      </div>
    </div>
  );
}

function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local
    .split(/[._-]/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
