// H1 · el gate de caja en el panel del cliente (ADR-016).
//
// Esconder una entrada del sidebar no basta: la URL sigue existiendo y
// alguien la tiene en un marcador. Sin este envoltorio, el propietario
// de un colegio que abra `/admin/cashiers` vería la pantalla montarse y
// después reventar contra el 403 `CAJA_DISABLED` de la API — el "error
// inesperado" que no explica nada.
//
// Mismo patrón que el auto-gate de `StaffPage` / `AgendaCatalogPage` con
// la agenda (ADR-R6), pero factorizado: son diez pantallas y copiar el
// bloque diez veces garantiza que la undécima se olvide.
//
// La puerta de verdad sigue siendo la del servidor (`lib/caja-gate.ts`).
// Esto es para que el cliente lea una frase en vez de un error.

import { useEffect, useState } from "react";

import { AdminShell } from "./AdminShell.js";
import { api, ApiError } from "./api.js";
import { CenteredLoader } from "./ui.js";

// `null` mientras carga. Al fallar devolvemos `true`: `caja_enabled` es
// `@default(true)` y esconderle la caja a quien cobra por un parpadeo de
// red sería el peor fallo posible (mismo criterio que el gate del
// servidor y que `useTenantCapabilities`).
export function useCajaEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<{ settings: { cajaEnabled?: boolean } }>("/admin/tenant/settings")
      .then((res) => {
        if (!cancelled) setEnabled(res.settings.cajaEnabled !== false);
      })
      .catch((err) => {
        if (cancelled) return;
        // Un 403 aquí sólo puede venir de la propia puerta.
        if (err instanceof ApiError && err.code === "CAJA_DISABLED") {
          setEnabled(false);
          return;
        }
        setEnabled(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}

/**
 * Envuelve una pantalla que sólo tiene sentido con caja. Mientras carga
 * pinta el loader de siempre; sin caja, una frase que dice de quién
 * depende encenderla (no del cliente: es comercial).
 */
export function CajaGate({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const cajaEnabled = useCajaEnabled();
  if (cajaEnabled === null) return <CenteredLoader label="Cargando…" />;
  if (cajaEnabled) return <>{children}</>;
  return (
    <AdminShell title={title}>
      <div className="bg-white rounded-2xl border border-slate-200 p-7 text-center max-w-lg mx-auto">
        <h2 className="text-[16px] font-semibold text-mipiace-ink">
          Esta sección es del módulo de caja
        </h2>
        <p className="text-[13.5px] text-slate-500 mt-1.5">
          Tu empresa no tiene la caja activada, así que aquí no hay nada que
          configurar. Si necesitas cobrar con el TPV, escríbenos y la
          encendemos nosotros.
        </p>
      </div>
    </AdminShell>
  );
}
