// personal-1 (decisión 2) · LA PLANTILLA, Y LO QUE LE FALTA A CADA FICHA.
//
// Es la lista de alta-minima aplicada al personal, y a propósito: el
// centro ya conoce esa pantalla de sus residentes. Etiqueta por fila, la
// cuenta arriba, el filtro «sólo incompletas» puesto por defecto mientras
// haya alguna, y «el aviso lleva a arreglarlo con un toque».
//
// Lo que esta pantalla NO enseña: ni un DNI ni un nº de afiliación. La
// respuesta del servidor tampoco los trae (sólo «lo tiene / no lo tiene»),
// así que no es disciplina de la pantalla: es que el dato no llega.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Upload, UserRound } from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import { CenteredLoader, FieldError, OutlineButton } from "../../ui.js";
import { jornada, type PersonalResponse, type PersonalRow } from "./lib.js";

export function PersonalPage() {
  const [data, setData] = useState<PersonalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Puesto por defecto **mientras haya alguna incompleta**, como en
  // alta-minima: el primer día son todas, y la pantalla tiene que abrirse
  // en el trabajo que hay, no en una lista completa que no dice nada.
  const [soloIncompletas, setSoloIncompletas] = useState(true);
  const [verBajas, setVerBajas] = useState(false);

  const cargar = useCallback(() => {
    api<PersonalResponse>("/admin/fichaje/personal")
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Error inesperado"),
      );
  }, []);

  useEffect(cargar, [cargar]);

  const visibles = useMemo(() => {
    if (!data) return [];
    return data.personal.filter((p) => {
      if (!verBajas && !p.active) return false;
      if (soloIncompletas && !p.faltan.incompleta) return false;
      return true;
    });
  }, [data, soloIncompletas, verBajas]);

  if (error) {
    return (
      <AdminShell title="Personal">
        <FieldError message={error} />
      </AdminShell>
    );
  }
  if (!data) return <CenteredLoader label="Cargando…" />;

  const { resumen } = data;

  return (
    <AdminShell title="Personal">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        La ficha de cada persona de la plantilla. Lo que falta se puede
        completar en cualquier momento: nadie deja de fichar por eso.
      </p>

      {/* La cuenta y los dos avisos del centro. */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <div
          className={`rounded-2xl border px-4 py-3.5 ${
            resumen.incompletas > 0
              ? "border-mipiace-coral/30 bg-mipiace-coral-soft"
              : "border-slate-200 bg-white"
          }`}
        >
          <p className="text-[14.5px] font-medium text-mipiace-ink">
            {/* «1 de 2 fichas sin completar» y no «… incompleta(s)»: con
                dos números delante, el adjetivo tiene que concordar con
                uno de los dos y siempre suena mal con el otro. */}
            {resumen.incompletas === 0
              ? `${resumen.total} ficha${resumen.total === 1 ? "" : "s"}, todas completas`
              : `${resumen.incompletas} de ${resumen.total} fichas sin completar`}
          </p>
          {resumen.incompletas > 0 && (
            <p className="mt-0.5 text-[12.5px] text-slate-600">
              {resumen.datosPendientes} dato
              {resumen.datosPendientes === 1 ? "" : "s"} pendiente
              {resumen.datosPendientes === 1 ? "" : "s"}
              {resumen.conImprescindibles > 0 &&
                ` · ${resumen.conImprescindibles} con algo imprescindible`}
            </p>
          )}
        </div>

        {/* El temporal al que se le acaba el contrato: es lo que hoy se
            olvida, y la razón de que la fecha de fin exista. */}
        {resumen.contratosQueAcaban.length > 0 ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3.5">
            <p className="text-[14.5px] font-medium text-mipiace-ink">
              {resumen.contratosQueAcaban.length === 1
                ? "A una persona se le acaba el contrato"
                : `A ${resumen.contratosQueAcaban.length} personas se les acaba el contrato`}
            </p>
            <ul className="mt-1 space-y-0.5">
              {resumen.contratosQueAcaban.map((c) => (
                <li key={c.employeeId} className="text-[12.5px] text-slate-700">
                  <Link
                    to={`/admin/fichaje/personal/${c.employeeId}`}
                    className="underline decoration-slate-300 hover:decoration-slate-500"
                  >
                    {c.nombre}
                  </Link>{" "}
                  ·{" "}
                  {c.dias < 0
                    ? `venció hace ${Math.abs(c.dias)} día${Math.abs(c.dias) === 1 ? "" : "s"}`
                    : c.dias === 0
                      ? "acaba hoy"
                      : `en ${c.dias} día${c.dias === 1 ? "" : "s"}`}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
            <p className="text-[14.5px] text-mipiace-ink-soft">
              Ningún contrato temporal se acaba en los próximos quince días.
            </p>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <Link to="/admin/fichaje/personal/importar" className="shrink-0">
          <OutlineButton className="!w-auto px-4">
            <Upload className="h-4 w-4" />
            Importar
          </OutlineButton>
        </Link>
        <Link to="/admin/fichaje/cuadrante" className="shrink-0">
          <OutlineButton className="!w-auto px-4">
            <CalendarClock className="h-4 w-4" />
            Cuadrante
          </OutlineButton>
        </Link>
        <label className="ml-auto flex items-center gap-2 text-[13px] text-slate-600">
          <input
            type="checkbox"
            checked={soloIncompletas}
            onChange={(e) => setSoloIncompletas(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Sólo incompletas
        </label>
        <label className="flex items-center gap-2 text-[13px] text-slate-600">
          <input
            type="checkbox"
            checked={verBajas}
            onChange={(e) => setVerBajas(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Ver bajas
        </label>
      </div>

      {visibles.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-[13px] text-slate-500">
          {soloIncompletas && resumen.incompletas === 0
            ? "Ninguna ficha tiene datos pendientes."
            : "No hay nadie que enseñar con estos filtros."}
        </div>
      ) : (
        // `data-lista` es un asidero para el banco: el aviso del contrato
        // temporal también lleva un enlace con un nombre dentro, y sin
        // esto «la fila de Bea no sale» y «Bea no aparece en la pantalla»
        // serían la misma comprobación — y la segunda es falsa.
        <ul data-lista="plantilla" className="space-y-2.5">
          {visibles.map((p) => (
            <Fila key={p.id} persona={p} />
          ))}
        </ul>
      )}
    </AdminShell>
  );
}

function Fila({ persona }: { persona: PersonalRow }) {
  const { faltan } = persona;
  // Rojo si falta algo imprescindible, ámbar si sólo recomendables. Mismo
  // criterio de color que la lista de residentes.
  const tono = faltan.conImprescindibles
    ? "border-mipiace-coral/30 bg-mipiace-coral-soft"
    : faltan.incompleta
      ? "border-amber-200 bg-amber-50"
      : "border-slate-200 bg-white";
  return (
    <li>
      <Link
        to={`/admin/fichaje/personal/${persona.id}`}
        className={`block rounded-2xl border px-4 py-3 transition-colors hover:brightness-[0.99] ${tono}`}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="flex items-center gap-2 text-[14.5px] font-medium text-mipiace-ink">
            <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
            {persona.nombreCompleto}
          </span>
          {!persona.active && (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11.5px] text-slate-600">
              De baja
            </span>
          )}
          {persona.categoria && (
            <span className="text-[12.5px] text-slate-500">
              {persona.categoria}
              {persona.atencionDirecta && " · atención directa"}
            </span>
          )}
          <span className="ml-auto text-[12.5px] tabular-nums text-slate-500">
            {jornada(persona.weeklyMinutes)}
            {persona.weeklyMinutes != null && " / semana"}
          </span>
        </div>
        {faltan.incompleta && (
          <p className="mt-1.5 text-[12.5px] text-slate-700">
            <span className="font-medium">
              Falta{faltan.faltan.length === 1 ? "" : "n"} {faltan.faltan.length}
              :
            </span>{" "}
            {/* La lista entera y no «faltan 4 datos»: leerla es lo que hace
                que alguien la complete sin abrir la ficha para ver qué era. */}
            {faltan.faltan.map((d) => d.etiqueta).join(", ")}
          </p>
        )}
      </Link>
    </li>
  );
}
