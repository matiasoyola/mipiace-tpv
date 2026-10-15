// residencia-1 · el gate de la residencia en el panel.
//
// Copia de `FichajeGate.tsx` con la misma dirección del fallo —la columna
// es `@default(false)`, así que ante la duda el módulo está APAGADO— y por
// la misma razón que en el servidor: enseñarle a un bar una sección que
// habla de residentes es peor que hacerle esperar medio segundo a Jardín
// de Gredos.
//
// Esconder la entrada del sidebar no basta: la URL sigue existiendo y
// alguien la tiene en un marcador. La puerta de verdad es la del servidor
// —y ahí la respuesta es una **404**, no esta frase—; ésta es para que la
// dirección de un centro al que todavía no se le ha encendido el módulo
// lea algo en vez de un error.

import { useEffect, useState } from "react";

import { AdminShell } from "./AdminShell.js";
import { api, ApiError } from "./api.js";
import { CenteredLoader } from "./ui.js";

/** `null` mientras carga. Al fallar, `false`. */
export function useResidenciaEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<{ settings: { residenciaEnabled?: boolean } }>("/admin/tenant/settings")
      .then((res) => {
        if (!cancelled) setEnabled(res.settings.residenciaEnabled === true);
      })
      .catch((err) => {
        if (cancelled) return;
        // Cualquier fallo deja el módulo apagado, incluido un
        // `RESIDENCIA_DISABLED` que hoy no existe (el servidor contesta
        // 404) y que se contempla por si algún día deja de esconderse.
        if (err instanceof ApiError) {
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

export function ResidenciaGate({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const enabled = useResidenciaEnabled();
  if (enabled === null) return <CenteredLoader label="Cargando…" />;
  if (enabled) return <>{children}</>;
  return (
    <AdminShell title={title}>
      <div className="bg-white rounded-2xl border border-slate-200 p-7 text-center max-w-lg mx-auto">
        <h2 className="text-[16px] font-semibold text-mipiace-ink">
          Esta sección es del módulo de residencia
        </h2>
        <p className="text-[13.5px] text-slate-500 mt-1.5">
          Tu empresa no lo tiene activado. Si llevas una residencia y
          necesitas registrar los cuidados de tus residentes, escríbenos y lo
          encendemos nosotros.
        </p>
      </div>
    </AdminShell>
  );
}
