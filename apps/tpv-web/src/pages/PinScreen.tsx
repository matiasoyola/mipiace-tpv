// Pantalla 2 del reference (TpvPinScreen). Lista de cajeros recientes
// (localStorage) + keypad numérico.

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronRight, Delete, Loader2, Plus } from "lucide-react";

import { apiWithDevice, ApiError } from "../api.js";
import { Logo } from "../Logo.js";
import {
  getRecentCashiers,
  rememberCashier,
  setCashierSession,
  type RecentCashier,
} from "../storage.js";

const AUTO_BLUR_MS = 30_000;
const PIN_LENGTH_TARGET = 4; // visualización mínima — el backend acepta 4-8.

interface CashierLoginResponse {
  sessionToken: string;
  sessionTtlMinutes: number;
  user: { id: string; email: string; role: "MANAGER" | "CASHIER" };
  shiftState:
    | { kind: "needsShiftOpen" }
    | { kind: "reanudar"; shift: { id: string; openedAt: string; cashOpening: string } }
    | {
        kind: "forceClose";
        shift: {
          id: string;
          openedAt: string;
          lastActivityAt: string;
          cashOpening: string;
          ownedByUserId: string;
        };
      };
}

export function PinScreen({
  registerName,
  onLoggedIn,
  onDeviceRevoked,
}: {
  registerName: string;
  onLoggedIn: (res: CashierLoginResponse) => void;
  onDeviceRevoked: () => void;
}) {
  const [recent, setRecent] = useState<RecentCashier[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [otherEmail, setOtherEmail] = useState<string>("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRecent(getRecentCashiers());
  }, []);

  // Auto-blur del PIN tras inactividad — limpia el PIN para evitar que
  // quede visible en pantalla si el cajero se aleja.
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!selectedEmail && !otherEmail) return;
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => setPin(""), AUTO_BLUR_MS);
    return () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, [pin, selectedEmail, otherEmail]);

  const activeEmail = selectedEmail ?? otherEmail.trim().toLowerCase();
  const canSubmit = activeEmail.length > 0 && pin.length >= PIN_LENGTH_TARGET;

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiWithDevice<CashierLoginResponse>(
        "/shift/cashier-login",
        { method: "POST", body: { email: activeEmail, pin } },
      );
      rememberCashier({
        email: res.user.email,
        initials: initialsOf(res.user.email),
        lastSeenAt: new Date().toISOString(),
      });
      setCashierSession({
        sessionToken: res.sessionToken,
        sessionTtlMinutes: res.sessionTtlMinutes,
        userId: res.user.id,
        email: res.user.email,
        role: res.user.role,
      });
      onLoggedIn(res);
    } catch (err) {
      setPin("");
      if (err instanceof ApiError) {
        if (err.code === "DEVICE_REVOKED" || err.status === 401 && err.code === "DEVICE_TOKEN_REQUIRED") {
          onDeviceRevoked();
          return;
        }
        setError(err.message);
      } else {
        setError("Error inesperado");
      }
    } finally {
      setBusy(false);
    }
  }

  function pressDigit(d: string) {
    if (pin.length >= 8 || busy) return;
    setPin(pin + d);
  }
  function pressBack() {
    setPin(pin.slice(0, -1));
  }

  return (
    <div className="min-h-screen bg-mipiace-stone flex flex-col font-sans">
      <header className="h-[72px] md:h-[88px] border-b border-slate-200 flex items-center justify-between px-5 md:px-7 bg-white">
        <Logo size={26} />
        <div className="text-[12.5px] text-slate-500">{registerName}</div>
      </header>
      <main className="flex-1 flex items-center justify-center p-5">
        <div className="w-full max-w-5xl grid md:grid-cols-2 gap-5 md:gap-8">
          {/* Recent cashiers */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 md:p-8">
            <h2 className="text-[14px] font-medium text-slate-500 uppercase tracking-wider mb-5">
              Cajeros recientes
            </h2>
            {recent.length === 0 ? (
              <div className="text-[13.5px] text-slate-500 bg-mipiace-stone rounded-2xl p-4">
                Aún no se ha registrado ningún cajero en este dispositivo.
                Introduce email y PIN abajo.
              </div>
            ) : (
              <div className="space-y-2.5">
                {recent.map((c) => (
                  <button
                    key={c.email}
                    onClick={() => {
                      setSelectedEmail(c.email);
                      setOtherEmail("");
                      setPin("");
                      setError(null);
                    }}
                    className={
                      selectedEmail === c.email
                        ? "w-full p-4 rounded-2xl bg-mipiace-coral-soft border border-mipiace-coral/30 flex items-center gap-4 text-left"
                        : "w-full p-4 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 flex items-center gap-4 text-left"
                    }
                  >
                    <span
                      className={
                        selectedEmail === c.email
                          ? "h-12 w-12 rounded-xl bg-mipiace-coral text-white text-[15px] font-semibold flex items-center justify-center shrink-0"
                          : "h-12 w-12 rounded-xl bg-mipiace-stone text-mipiace-ink text-[15px] font-semibold flex items-center justify-center shrink-0"
                      }
                    >
                      {c.initials ?? initialsOf(c.email)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div
                        className={
                          selectedEmail === c.email
                            ? "text-[15px] font-medium text-mipiace-coral-dark truncate"
                            : "text-[15px] font-medium text-mipiace-ink truncate"
                        }
                      >
                        {c.email}
                      </div>
                      <div className="text-[12.5px] text-slate-500 mt-0.5">
                        Último acceso {formatShortDate(c.lastSeenAt)}
                      </div>
                    </div>
                    <ChevronRight
                      className={
                        selectedEmail === c.email
                          ? "w-4 h-4 text-mipiace-coral"
                          : "w-4 h-4 text-slate-300"
                      }
                    />
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4">
              <label htmlFor="cashierEmail" className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
                {recent.length === 0 ? "Email del cajero" : "O usar otro cajero"}
              </label>
              <input
                id="cashierEmail"
                name="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                value={otherEmail}
                onChange={(e) => {
                  setOtherEmail(e.target.value);
                  setSelectedEmail(null);
                  setPin("");
                  setError(null);
                }}
                placeholder="cajero@negocio.com"
                className="w-full h-12 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] text-mipiace-ink focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
              />
              {!selectedEmail && otherEmail.length === 0 && recent.length > 0 && (
                <div className="mt-3 text-[12.5px] text-slate-400 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  Empieza a teclear el email del cajero
                </div>
              )}
            </div>
          </div>

          {/* Keypad */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 md:p-8 flex flex-col">
            <div className="text-center mb-6">
              <div className="text-[14px] text-slate-500 mb-1">Introduce el PIN</div>
              <div className="text-[20px] font-semibold text-mipiace-ink tracking-tight truncate">
                {activeEmail || "—"}
              </div>
            </div>
            <div className="flex justify-center gap-3 mb-7">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={
                    i < pin.length
                      ? "w-3.5 h-3.5 rounded-full bg-mipiace-coral"
                      : "w-3.5 h-3.5 rounded-full bg-slate-200"
                  }
                />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2.5 md:gap-3 max-w-xs mx-auto w-full">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => pressDigit(n)}
                  className="h-14 md:h-16 bg-mipiace-stone hover:bg-slate-100 rounded-2xl text-[22px] md:text-[24px] font-medium text-mipiace-ink tabular-nums disabled:opacity-50"
                  disabled={busy}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setPin("");
                  setError(null);
                }}
                className="h-14 md:h-16 rounded-2xl text-[14px] text-slate-400 hover:text-mipiace-ink font-medium"
              >
                Borrar
              </button>
              <button
                type="button"
                onClick={() => pressDigit("0")}
                disabled={busy}
                className="h-14 md:h-16 bg-mipiace-stone hover:bg-slate-100 rounded-2xl text-[22px] md:text-[24px] font-medium text-mipiace-ink tabular-nums disabled:opacity-50"
              >
                0
              </button>
              <button
                type="button"
                onClick={pressBack}
                className="h-14 md:h-16 bg-mipiace-stone hover:bg-slate-100 rounded-2xl flex items-center justify-center text-slate-500"
                aria-label="Borrar último dígito"
              >
                <Delete className="w-5 h-5" strokeWidth={2.25} />
              </button>
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="mt-6 w-full h-14 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[15px] rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Entrar
            </button>
            {error && (
              <div className="mt-4 flex items-start gap-2 text-[13px] text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5">
                <AlertCircle className="w-4 h-4 mt-px shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function initialsOf(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local
    .split(/[._-]/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (
    d.getUTCFullYear() === today.getUTCFullYear() &&
    d.getUTCMonth() === today.getUTCMonth() &&
    d.getUTCDate() === today.getUTCDate()
  ) {
    return `hoy ${d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

export type { CashierLoginResponse };
