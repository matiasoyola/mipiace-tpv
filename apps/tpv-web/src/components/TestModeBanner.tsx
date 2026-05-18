// B-OnboardingV2 · Banner amarillo persistente cuando el TPV opera en
// modo prueba. Muestra el nombre del tenant + countdown hasta que el
// JWT caduca. Botón "Salir" limpia sessionStorage y cierra la pestaña.

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

import { clearTestMode, readTestModeState } from "../lib/test-mode.js";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "caducado";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

export function TestModeBanner({ tenantName }: { tenantName: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const state = readTestModeState();
  if (!state) return null;
  const remainingMs = state.expiresAt - now;
  const expired = remainingMs <= 0;

  return (
    <div
      className={`w-full ${
        expired ? "bg-red-100 border-red-300 text-red-900" : "bg-amber-100 border-amber-300 text-amber-900"
      } border-b px-4 py-2.5 flex items-center gap-3 text-[13px]`}
      role="alert"
    >
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <strong>Modo prueba</strong> · ventas no se suben a Holded · cliente:{" "}
        <strong className="text-amber-950">{tenantName ?? "—"}</strong>
        {!expired ? (
          <>
            {" "}· caduca en <span className="tabular-nums">{formatRemaining(remainingMs)}</span>
          </>
        ) : (
          <> · sesión caducada</>
        )}
      </div>
      <button
        onClick={() => {
          clearTestMode();
          // window.close sólo funciona si la pestaña la abrió otro
          // origen vía window.open. Si falla, redirigimos al login.
          window.close();
          setTimeout(() => {
            window.location.href = "/";
          }, 100);
        }}
        className="inline-flex items-center gap-1 h-8 px-2.5 border border-amber-400 text-amber-900 hover:bg-amber-200 rounded-md text-[12px] font-medium"
      >
        <X className="w-3.5 h-3.5" />
        Salir
      </button>
    </div>
  );
}
