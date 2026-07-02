// v1.0-pilotos · Lote 4 addendum: modal de re-login in situ.
//
// Cuando la sesión del cajero caduca a mitad de una acción (carrito
// abierto, checkout en curso), el wrapper apiWithCashier dispara este
// modal en vez de tirar el error "Sesión inválida o expirada" sin
// salida. El cajero teclea su PIN sin navegar — el estado del carrito
// y del checkout no se toca — y al validar, la request que falló se
// reintenta automáticamente.

import { useState } from "react";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";

import { apiWithDevice, ApiError } from "../api.js";
import { cashierDisplayLabel, setCashierSession } from "../storage.js";

interface ReloginResponse {
  sessionToken: string;
  sessionTtlMinutes: number;
  user: {
    id: string;
    email: string;
    alias: string | null;
    role: "MANAGER" | "CASHIER";
  };
}

export function ReloginPinModal(props: {
  // El email sigue siendo la credencial del login; el alias es sólo
  // lo que se muestra (v1.7-alias-cajeros).
  email: string;
  alias: string | null;
  // true → sesión renovada (la request original se reintenta).
  // false → el cajero canceló (la acción falla con el 401 original).
  onDone: (renewed: boolean) => void;
}) {
  const [pin, setPin] = useState("");
  const [pinVisible, setPinVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiWithDevice<ReloginResponse>("/shift/cashier-login", {
        method: "POST",
        body: { email: props.email, pin },
      });
      setCashierSession({
        sessionToken: res.sessionToken,
        sessionTtlMinutes: res.sessionTtlMinutes,
        userId: res.user.id,
        email: res.user.email,
        alias: res.user.alias,
        role: res.user.role,
      });
      props.onDone(true);
    } catch (err) {
      setPin("");
      setError(
        err instanceof ApiError ? err.message : "No se pudo renovar la sesión",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-mipiace-ink/60 flex items-center justify-center p-4 font-sans">
      <div className="bg-white w-full max-w-sm rounded-3xl border border-slate-200 p-6">
        <div className="flex items-center gap-2.5 mb-1">
          <Lock className="w-[18px] h-[18px] text-mipiace-coral" />
          <h2 className="text-[17px] font-semibold text-mipiace-ink">
            Sesión caducada
          </h2>
        </div>
        <p className="text-[13px] text-slate-500 mb-4">
          Vuelve a introducir tu PIN para continuar donde estabas. El ticket
          en curso no se pierde.
        </p>
        <div className="text-[13.5px] font-medium text-mipiace-ink mb-2 truncate">
          {cashierDisplayLabel(props)}
        </div>
        <div className="relative mb-3">
          <input
            autoFocus
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, "").slice(0, 16));
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            type={pinVisible ? "text" : "password"}
            inputMode="numeric"
            autoComplete="off"
            placeholder="PIN"
            aria-label="PIN del cajero"
            className="w-full h-14 pl-4 pr-12 text-[18px] font-semibold tracking-[0.3em] tabular-nums bg-mipiace-stone border border-transparent rounded-2xl focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:bg-white focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setPinVisible((v) => !v)}
            tabIndex={-1}
            aria-label={pinVisible ? "Ocultar PIN" : "Mostrar PIN"}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 h-9 w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-mipiace-ink"
          >
            {pinVisible ? (
              <EyeOff className="w-[18px] h-[18px]" />
            ) : (
              <Eye className="w-[18px] h-[18px]" />
            )}
          </button>
        </div>
        {error && (
          <div className="mb-3 text-[12.5px] text-red-700 bg-red-50 rounded-xl px-3 py-2">
            {error}
          </div>
        )}
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => props.onDone(false)}
            disabled={busy}
            className="flex-1 h-12 rounded-2xl border border-slate-200 hover:bg-slate-50 text-[13.5px] text-mipiace-ink-soft font-medium"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || pin.length < 4}
            className="flex-1 h-12 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}
