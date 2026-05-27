// Pantalla 1 del reference (docs/design/reference-app.tsx · TpvPairScreen).
// La PWA arranca aquí cuando no hay device token o el server rechaza
// el actual.

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { apiPublic, ApiError } from "../api.js";
import { Logo } from "../Logo.js";
import { setDeviceToken } from "../storage.js";

interface PairResponse {
  deviceToken: string;
  deviceId: string;
  tenantId: string;
  registerId: string;
  registerName: string;
  storeName: string;
}

export function PairScreen({ onPaired }: { onPaired: () => void }) {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState<PairResponse | null>(null);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  // v1.3-UX-Iteración-fixes Fix 5: auto-focus al primer dígito al montar
  // es uno de los pocos casos legítimos de focus programático en este
  // TPV. La PairScreen es la PRIMERA pantalla que ve el cajero al
  // abrir la app sin device token; su única acción posible es teclear
  // el código de 6 dígitos. Abrir el IME aquí ahorra un tap y no
  // interfiere con ningún flujo táctil.
  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  function onDigit(idx: number, value: string) {
    const clean = value.replace(/\D/g, "").slice(0, 1);
    setDigits((d) => {
      const next = [...d];
      next[idx] = clean;
      return next;
    });
    if (clean && idx < 5) refs.current[idx + 1]?.focus();
  }

  function onKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const txt = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (txt.length === 6) {
      e.preventDefault();
      setDigits(txt.split(""));
      refs.current[5]?.focus();
    }
  }

  const code = digits.join("");
  const ready = code.length === 6 && !busy;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPublic<PairResponse>("/devices/pair", {
        method: "POST",
        body: {
          code,
          deviceName: navigator.userAgent.slice(0, 80),
          userAgent: navigator.userAgent.slice(0, 512),
        },
      });
      setDeviceToken(res.deviceToken);
      setPaired(res);
      // Pequeño delay para que el cajero vea el "Vinculado a…" antes
      // de pasar al PIN.
      setTimeout(onPaired, 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setDigits(["", "", "", "", "", ""]);
      refs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  if (paired) {
    return (
      <Centered>
        <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center">
          <div className="h-14 w-14 mx-auto rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M20 6L9 17l-5-5"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight mb-2">
            Vinculado a {paired.registerName}
          </h1>
          <p className="text-[13.5px] text-slate-500">
            de {paired.storeName}. Cargando…
          </p>
        </div>
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="bg-white rounded-3xl border border-slate-200 p-7 md:p-10">
        <h1 className="text-[22px] md:text-[24px] font-semibold text-mipiace-ink tracking-tight mb-2">
          Vincula este dispositivo
        </h1>
        <p className="text-[14px] text-slate-500 mb-7 leading-relaxed">
          Pide al propietario o encargado un código de 6 dígitos desde el
          admin y mételo aquí. El código expira en una hora.
        </p>
        <form onSubmit={onSubmit}>
          <div className="grid grid-cols-6 gap-2 mb-6">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                value={d}
                onChange={(e) => onDigit(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
                onPaste={onPaste}
                inputMode="numeric"
                maxLength={1}
                disabled={busy}
                className="h-14 md:h-16 text-center text-[22px] md:text-[26px] font-semibold text-mipiace-ink rounded-xl border border-slate-200 bg-mipiace-stone focus:outline-none focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:bg-white tabular-nums placeholder:text-slate-300 placeholder:font-medium"
                aria-label={`Dígito ${i + 1}`}
              />
            ))}
          </div>
          <button
            type="submit"
            disabled={!ready}
            className="w-full h-14 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[15px] rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Vincular dispositivo
          </button>
          {error && (
            <div className="mt-4 flex items-start gap-2 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5">
              <AlertCircle className="w-4 h-4 mt-px shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </form>
        <div className="mt-6 pt-6 border-t border-slate-100 text-center">
          <p className="text-[12.5px] text-slate-400 leading-relaxed">
            Una vez vinculado, este dispositivo quedará asociado a una caja
            específica y no volverá a pedirte código.
          </p>
        </div>
      </div>
      <div className="text-center mt-6 text-[11.5px] text-slate-400">
        mipiacetpv · Conectado a mipiacetpv.com
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-mipiace-stone to-white flex items-center justify-center p-5 font-sans">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-10">
          <Logo size={36} />
        </div>
        {children}
      </div>
    </div>
  );
}
