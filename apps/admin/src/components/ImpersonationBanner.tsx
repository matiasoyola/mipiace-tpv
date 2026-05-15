// Banner rojo persistente arriba del AdminShell cuando hay sesión de
// impersonación activa. Muestra countdown al expiración y un botón
// "Salir de impersonación" que limpia el sessionStorage y cierra la
// pestaña (o vuelve a /superadmin/tenants si es la misma ventana).

import { useEffect, useState } from "react";
import { AlertOctagon, X } from "lucide-react";

import {
  clearImpersonationToken,
  readImpersonationState,
  type ImpersonationState,
} from "../api.js";

function fmtCountdown(msLeft: number): string {
  if (msLeft <= 0) return "expirada";
  const totalSec = Math.floor(msLeft / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function ImpersonationBanner() {
  const [state, setState] = useState<ImpersonationState | null>(() =>
    readImpersonationState(),
  );
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      // Re-leer por si caducó y otro código limpió el token.
      const fresh = readImpersonationState();
      setState(fresh);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  if (!state) return null;

  const msLeft = state.expiresAt - now;
  const expired = msLeft <= 0;

  function onExit(): void {
    clearImpersonationToken();
    setState(null);
    // Intentamos cerrar la pestaña. Si fue abierta con window.open desde
    // la consola super-admin, se cierra. Si el navegador lo bloquea,
    // redirigimos al login para no quedar en pantalla huérfana.
    setTimeout(() => {
      window.close();
      window.location.href = "/login";
    }, 50);
  }

  return (
    <div
      className={
        "sticky top-0 z-50 px-4 py-2.5 flex items-center gap-3 text-white text-[13px] font-medium " +
        (expired ? "bg-red-800" : "bg-red-600")
      }
      role="alert"
    >
      <AlertOctagon className="w-4 h-4 shrink-0" />
      <span className="flex-1">
        {expired
          ? "Sesión de impersonación caducada. Reabre desde la consola super-admin."
          : "Sesión de impersonación · sólo lectura · caduca en "}
        {!expired && (
          <span className="font-mono tabular-nums">{fmtCountdown(msLeft)}</span>
        )}
      </span>
      <button
        onClick={onExit}
        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-white/15 hover:bg-white/25 text-[12px]"
      >
        <X className="w-3.5 h-3.5" /> Salir
      </button>
    </div>
  );
}
