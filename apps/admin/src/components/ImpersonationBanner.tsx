// Banner persistente arriba del AdminShell cuando hay sesión de
// impersonación activa. Muestra countdown al expiración y un botón
// "Salir" que limpia el sessionStorage y cierra la pestaña (o vuelve a
// /login si es la misma ventana).
//
// v1.3-SuperAdmin-Hub Lote 1: el banner distingue dos modos:
//   - readonly → rojo, "viendo como X · sólo lectura"
//   - full     → ámbar, "configurando como X · modo escritura"
// El ámbar comunica que cualquier acción del super-admin queda
// registrada y modifica datos reales del cliente.

import { useEffect, useState } from "react";
import { AlertOctagon, AlertTriangle, X } from "lucide-react";

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
  const isFull = state.mode === "full";

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

  const bg = expired
    ? "bg-slate-700"
    : isFull
      ? "bg-amber-600"
      : "bg-red-600";

  const Icon = isFull ? AlertTriangle : AlertOctagon;

  return (
    <div
      className={
        "sticky top-0 z-50 px-4 py-2.5 flex items-center gap-3 text-white text-[13px] font-medium " +
        bg
      }
      role="alert"
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1">
        {expired ? (
          "Sesión de impersonación caducada. Reabre desde la consola super-admin."
        ) : isFull ? (
          <>
            Modo super-admin · configurando este tenant ·{" "}
            <strong>modo escritura</strong> · caduca en{" "}
            <span className="font-mono tabular-nums">{fmtCountdown(msLeft)}</span>
          </>
        ) : (
          <>
            Modo super-admin · viendo este tenant ·{" "}
            <strong>sólo lectura</strong> · caduca en{" "}
            <span className="font-mono tabular-nums">{fmtCountdown(msLeft)}</span>
          </>
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
