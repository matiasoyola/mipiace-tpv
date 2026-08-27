// Pantalla 3 del reference (TpvShiftOpenScreen). Fondo de caja inicial
// con quick keys.

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { apiWithCashier, ApiError } from "../api.js";
import { AmountField } from "../components/AmountField.js";
import { CashPad } from "../components/CashPad.js";
import { parseAmount } from "../lib/money.js";
import { Logo } from "../Logo.js";
import { outboxAdd } from "../lib/outbox.js";
import { openLocalShift } from "../lib/offlineShift.js";

interface ShiftOpenResponse {
  shift: { id: string; openedAt: string; cashOpening: string };
}

export function ShiftOpenScreen({
  cashierLabel,
  registerName,
  storeName,
  offline = false,
  onOpened,
  onBack,
}: {
  cashierLabel: string;
  registerName: string;
  storeName: string;
  // v1.10-offline: la sesión se abrió sin red (aún sin JWT). Abrimos el
  // turno EN LOCAL y encolamos el POST /shift/open.
  offline?: boolean;
  onOpened: (
    shift: { id: string; openedAt: string; cashOpening: string },
    openedOffline: boolean,
  ) => void;
  onBack: () => void;
}) {
  const [amount, setAmount] = useState<string>("0,00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // v1.12-manos-de-camarero · el pad del fondo de caja. Cerrado al
  // entrar: el atajo de 100 € resuelve el caso normal de un toque.
  const [padOpen, setPadOpen] = useState(false);

  // v1.12 · el parseo de importes va por `lib/money.ts` (v1.10.3), que
  // ya tolera coma, punto, espacios y el símbolo €.
  const parsed = parseAmount(amount);
  // Campo vacío ≠ 0,00: vacío es "no introducido" y "Abrir turno"
  // sigue bloqueado.
  const ready = amount.trim() !== "" && parsed >= 0 && !busy;

  // v1.10-offline: abre el turno en local (latencia percibida cero) y
  // encola el POST /shift/open. El localId es el externalId de
  // idempotencia; el outbox reescribe los tickets a shiftId real cuando
  // la apertura sincroniza.
  async function openOffline() {
    const shift = await openLocalShift(parsed);
    await outboxAdd({
      externalId: shift.localId,
      kind: "shift-open",
      path: "/shift/open",
      body: { cashOpening: parsed },
      label: "Apertura de turno",
      total: parsed,
      shiftLocalId: shift.localId,
    });
    onOpened(
      { id: shift.localId, openedAt: shift.openedAt, cashOpening: String(parsed) },
      true,
    );
  }

  async function onSubmit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    // Sin red (o sesión offline): directo a local.
    if (offline || !navigator.onLine) {
      try {
        await openOffline();
      } catch {
        setError("No se pudo abrir el turno offline.");
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const res = await apiWithCashier<ShiftOpenResponse>("/shift/open", {
        method: "POST",
        body: { cashOpening: parsed },
      });
      onOpened(res.shift, false);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        // Error de red a mitad de la apertura (la sesión era online pero
        // cayó la conexión): degradamos a apertura offline.
        try {
          await openOffline();
        } catch {
          setError("No se pudo abrir el turno.");
        }
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
          <div className="flex items-center gap-3 mb-1">
            <span className="h-11 w-11 rounded-xl bg-mipiace-coral text-white text-[15px] font-semibold flex items-center justify-center">
              {initials(cashierLabel)}
            </span>
            <div>
              <div className="text-[15px] font-medium text-mipiace-ink truncate max-w-[260px]">
                {cashierLabel}
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
          {/* v1.12 · el importe se teclea con el CashPad de la app, no
              con el de Android (hallazgo H2). */}
          <div className="mb-3">
            <AmountField
              id="cashOpening"
              value={amount}
              active={padOpen}
              onActivate={() => setPadOpen(true)}
              size="lg"
              ariaLabel="Fondo de caja inicial"
            />
          </div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {["50,00", "100,00", "150,00", "200,00"].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(v)}
                className="h-touch rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[13px] font-medium text-mipiace-ink tabular-nums"
              >
                {v} €
              </button>
            ))}
          </div>
          {padOpen && (
            <div className="mb-3">
              <div className="flex justify-end mb-2">
                <button
                  type="button"
                  onClick={() => setPadOpen(false)}
                  className="h-touch px-4 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[13px] font-medium text-mipiace-ink"
                >
                  Listo
                </button>
              </div>
              <CashPad value={amount} onChange={setAmount} />
            </div>
          )}
          <div className="mb-4" />
          <button
            type="button"
            onClick={onSubmit}
            disabled={!ready}
            className="w-full h-touch-lg bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[16px] rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2"
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
            className="w-full mt-3 h-touch text-[13.5px] text-slate-500 hover:text-mipiace-ink font-medium"
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
