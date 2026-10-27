// personal-1 (decisión 6) · EL REGISTRO DE CAMBIOS TRAS PUBLICAR.
//
// Es lo que pide la Inspección cuando un trabajador dice que le cambiaron
// el turno sin avisar: qué tenía, qué tiene, quién lo cambió, cuándo y por
// qué.
//
// Append-only en la base (trigger `staff_schedule_changes_append_only`), y
// por eso esta pantalla **no tiene ni un botón**: no hay nada que editar
// ni que borrar. Si lo tuviera, alguien lo buscaría.

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import { CenteredLoader, FieldError } from "../../ui.js";
import {
  AUSENCIAS_LABEL,
  mesActual,
  mesLargo,
  type CambioDelCuadranteRow,
} from "./lib.js";

export function CambiosDelCuadrantePage() {
  const mes =
    new URLSearchParams(window.location.search).get("mes") ?? mesActual();
  const [cambios, setCambios] = useState<CambioDelCuadranteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    api<{ cambios: CambioDelCuadranteRow[] }>(
      `/admin/fichaje/cuadrante/${mes}/cambios`,
    )
      .then((r) => setCambios(r.cambios))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Error inesperado"),
      );
  }, [mes]);

  useEffect(cargar, [cargar]);

  if (error) {
    return (
      <AdminShell title="Cambios del cuadrante">
        <FieldError message={error} />
      </AdminShell>
    );
  }
  if (!cambios) return <CenteredLoader label="Cargando…" />;

  return (
    <AdminShell title="Cambios del cuadrante">
      <Link
        to={`/admin/fichaje/cuadrante?mes=${mes}`}
        className="-mt-2 mb-4 inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-mipiace-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        {mesLargo(mes)}
      </Link>

      <p className="mb-5 text-[13.5px] text-slate-500">
        Todo lo que se ha cambiado en este cuadrante <strong>después</strong> de
        publicarlo. No se puede editar ni borrar: lo impide la base de datos, no
        esta pantalla.
      </p>

      {cambios.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-[13px] text-slate-500">
          No se ha cambiado nada desde que se publicó. Los cambios de un
          cuadrante en borrador no se registran: todavía no se le había
          enseñado a nadie.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {cambios.map((c) => (
            <li
              key={c.id}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="text-[14.5px] font-medium text-mipiace-ink">
                  {c.employeeName}
                </span>
                <span className="text-[13px] text-slate-500">· {c.dia}</span>
                <span className="text-[13px] text-mipiace-ink">
                  {etiqueta(c.antes)} → {etiqueta(c.despues)}
                </span>
                <span className="ml-auto text-[12px] text-slate-400">
                  {new Intl.DateTimeFormat("es-ES", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Europe/Madrid",
                  }).format(new Date(c.cuando))}
                </span>
              </div>
              <p className="mt-1 text-[12.5px] text-slate-700">
                «{c.motivo}» — {c.autor}
              </p>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}

/** «N», «M+T», «Vacaciones», o «nada» cuando el día estaba en blanco. */
function etiqueta(valor: string | null): string {
  if (valor == null) return "nada";
  return AUSENCIAS_LABEL[valor] ?? valor;
}
