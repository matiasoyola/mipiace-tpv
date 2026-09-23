// F1 · la app de fichar (ADR-018).
//
// Vive DENTRO de apps/admin pero no comparte nada con el panel: ni el
// router, ni la sesión, ni el shell. `main.tsx` decide por la ruta y sólo
// carga una de las dos ramas, así que el móvil de un profesor no se traga
// el bundle de treinta pantallas del propietario.
//
// Tres estados y nada más:
//   · emparejando  — se abrió con `?p=<token>`
//   · sin móvil    — no hay token guardado y no hay enlace
//   · fichando     — la pantalla de verdad

import { useCallback, useEffect, useState } from "react";

import {
  clearEmployeeToken,
  ficharApi,
  FicharApiError,
  readEmployeeToken,
  storeEmployeeToken,
} from "./lib/api.js";
import { startOutboxSync } from "./lib/outbox.js";
import { installFicharPwaTags, registerFicharServiceWorker } from "./lib/pwa.js";
import { Fichar } from "./screens/Fichar.js";
import { SalidaOlvidada } from "./screens/SalidaOlvidada.js";
import type { MeResponse } from "./lib/tipos.js";

type Estado =
  | { fase: "cargando" }
  | { fase: "sin-movil"; motivo: string }
  | { fase: "fichando"; me: MeResponse };

export function FicharApp() {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });

  const cargar = useCallback(async () => {
    try {
      const me = await ficharApi<MeResponse>("/fichaje/v1/me");
      setEstado({ fase: "fichando", me });
    } catch (err) {
      if (err instanceof FicharApiError && err.status === 401) {
        clearEmployeeToken();
        setEstado({ fase: "sin-movil", motivo: err.message });
        return;
      }
      setEstado({
        fase: "sin-movil",
        motivo:
          err instanceof FicharApiError
            ? err.message
            : "No hemos podido conectar. Prueba otra vez en un momento.",
      });
    }
  }, []);

  useEffect(() => {
    installFicharPwaTags();
    registerFicharServiceWorker();
    const parar = startOutboxSync();
    return parar;
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const url = new URL(window.location.href);
      const enlace = url.searchParams.get("p");
      if (enlace) {
        // El token del enlace no debe quedarse en la barra ni en el
        // historial: se canjea y se limpia la URL en el sitio.
        url.searchParams.delete("p");
        window.history.replaceState(null, "", url.pathname + url.search);
        try {
          const res = await ficharApi<{ employeeToken: string }>(
            "/fichaje/v1/pair",
            {
              method: "POST",
              token: null,
              body: { token: enlace, userAgent: navigator.userAgent.slice(0, 500) },
            },
          );
          storeEmployeeToken(res.employeeToken);
        } catch (err) {
          if (!vivo) return;
          setEstado({
            fase: "sin-movil",
            motivo:
              err instanceof FicharApiError
                ? err.message
                : "Este enlace no ha funcionado.",
          });
          return;
        }
      } else if (!readEmployeeToken()) {
        if (!vivo) return;
        setEstado({
          fase: "sin-movil",
          motivo:
            "Este móvil todavía no está emparejado. Pídele a tu empresa tu enlace personal.",
        });
        return;
      }
      if (vivo) await cargar();
    })();
    return () => {
      vivo = false;
    };
  }, [cargar]);

  if (estado.fase === "cargando") {
    return (
      <div className="flex min-h-full items-center justify-center text-[15px] text-slate-400">
        Un momento…
      </div>
    );
  }

  if (estado.fase === "sin-movil") {
    return <SinMovil motivo={estado.motivo} />;
  }

  // LA SALIDA OLVIDADA VA PRIMERO. Antes que el botón, antes que nada.
  if (estado.me.pendingExit) {
    return (
      <SalidaOlvidada
        pendingExit={estado.me.pendingExit}
        timeZone={estado.me.timeZone}
        onResuelta={cargar}
      />
    );
  }

  return <Fichar me={estado.me} onRecargar={cargar} />;
}

/** Enlace caducado, ya usado, móvil revocado o empleado de baja: todos
 *  acaban aquí, con una frase que dice qué hacer y sin mandar a nadie a
 *  /login. */
function SinMovil({ motivo }: { motivo: string }) {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm rounded-3xl bg-white p-7 text-center">
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-mipiace-ink">
          Este enlace ya no vale
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-500">{motivo}</p>
        <p className="mt-5 text-[13px] text-slate-400">
          Los enlaces de fichaje se usan una sola vez y caducan a los 7 días.
        </p>
      </div>
    </div>
  );
}
