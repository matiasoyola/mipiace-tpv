// F1 · el gate del control horario en el panel (ADR-018).
//
// Copia literal de `CajaGate.tsx`, con la dirección del fallo invertida y
// por la misma razón que en el servidor (`lib/fichaje-gate.ts`): la
// columna es `@default(false)`, así que ante la duda el módulo está
// APAGADO. Enseñarle a un bar una sección que no ha comprado es peor que
// hacerle esperar un segundo a un colegio.
//
// Esconder la entrada del sidebar no basta: la URL sigue existiendo y
// alguien la tiene en un marcador. La puerta de verdad es la del servidor;
// ésta es para que el cliente lea una frase en vez de un error.

import { useEffect, useState } from "react";

import { AdminShell } from "./AdminShell.js";
import { api, ApiError } from "./api.js";
import { CenteredLoader } from "./ui.js";

/** `null` mientras carga. Al fallar, `false`. */
export function useFichajeEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<{ settings: { fichajeEnabled?: boolean } }>("/admin/tenant/settings")
      .then((res) => {
        if (!cancelled) setEnabled(res.settings.fichajeEnabled === true);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === "FICHAJE_DISABLED") {
          setEnabled(false);
          return;
        }
        setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}

export function FichajeGate({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const enabled = useFichajeEnabled();
  if (enabled === null) return <CenteredLoader label="Cargando…" />;
  if (enabled) return <>{children}</>;
  return (
    <AdminShell title={title}>
      <div className="bg-white rounded-2xl border border-slate-200 p-7 text-center max-w-lg mx-auto">
        <h2 className="text-[16px] font-semibold text-mipiace-ink">
          Esta sección es del módulo de control horario
        </h2>
        <p className="text-[13.5px] text-slate-500 mt-1.5">
          Tu empresa no lo tiene activado. Si necesitas llevar el registro de
          jornada de tu personal, escríbenos y lo encendemos nosotros.
        </p>
      </div>
    </AdminShell>
  );
}
