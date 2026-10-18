// residencia-5 (D-18, D-19) · **UN PARTE DE RELEVO.**
//
// El mismo parte que se lee en la sala, con dos cosas más que allí no
// hacen falta y aquí sí:
//
//   1. **las confirmaciones con sus DOS horas** —cuándo se firmó y cuándo
//      llegó—, que es lo que hace visible una que se encoló sin red;
//   2. **las zonas que faltan por confirmar**, con nombre.
//
// ── EL DEL TURNO EN CURSO SE VE EN VIVO ─────────────────────────────
//
// `/admin/residencia/relevos/vivo` pinta el parte del turno que está
// pasando, calculado al momento y **sin fila en la base** (ver la cabecera
// de `relevo.ts`). Es la misma pantalla con un aviso arriba: lo que se ve
// ahí todavía puede cambiar, y por eso no se puede confirmar.
//
// La URL es `vivo` y no un uuid, y el orden de registro de las rutas en la
// API lo tiene en cuenta: con `/:id` delante, Fastify intentaría leer
// «vivo» como un uuid y contestaría 400.

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import { CenteredLoader, FieldError } from "../../ui.js";
import {
  dia,
  hora,
  NOMBRE_DEL_TARDIO,
  NOMBRE_DE_LA_CLASE,
  type AnadidoTardio,
  type LineaDelParte,
  type ParteDeRelevo,
  type RelevoDetalle,
} from "./relevo-lib.js";
import { colorDelNivel } from "./incidencias-lib.js";

export function RelevoPage() {
  const { id } = useParams<{ id: string }>();
  const enVivo = id === "vivo";
  const [detalle, setDetalle] = useState<RelevoDetalle | null>(null);
  const [vivo, setVivo] = useState<{
    parte: ParteDeRelevo | null;
    sinTurno: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    if (!id) return;
    try {
      if (enVivo) {
        setVivo(
          await api<{ parte: ParteDeRelevo | null; sinTurno: boolean }>(
            "/residencia/relevos/vivo",
          ),
        );
      } else {
        const r = await api<{ relevo: RelevoDetalle }>(
          `/residencia/relevos/${id}`,
        );
        setDetalle(r.relevo);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, [id, enVivo]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (error) {
    return (
      <AdminShell title="Relevo">
        <FieldError message={error} />
        <Link
          to="/admin/residencia/relevos"
          className="mt-4 inline-block text-[13px] text-mipiace-coral underline"
        >
          Volver a los relevos
        </Link>
      </AdminShell>
    );
  }

  // ── El del turno en curso ────────────────────────────────────────
  if (enVivo) {
    if (!vivo) return <CenteredLoader label="Calculando el parte…" />;
    return (
      <AdminShell title="Relevo del turno en curso">
        <div className="mb-5 rounded-2xl border-2 border-amber-300 bg-amber-50 px-5 py-4 text-[13.5px] text-amber-900">
          <strong>Este parte está en vivo.</strong> Se calcula ahora mismo y
          todavía puede cambiar: se congela cuando acabe el turno, y es
          entonces cuando se puede confirmar en la sala.
        </div>
        {vivo.sinTurno ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
            Los turnos del centro no cubren esta hora: hay un hueco en el
            cuadrante, así que no hay turno del que hacer parte.
          </p>
        ) : vivo.parte == null ? (
          <p className="text-[13.5px] text-slate-500">No hay nada que contar.</p>
        ) : (
          <Parte parte={vivo.parte} />
        )}
      </AdminShell>
    );
  }

  if (!detalle) return <CenteredLoader label="Cargando el parte…" />;

  return (
    <AdminShell title={`Relevo de ${detalle.turno.name.toLowerCase()}`}>
      <p className="-mt-2 mb-4 text-[13.5px] text-slate-500">
        {dia(detalle.careDay)} · congelado a las {hora(detalle.congeladoEn)} ·{" "}
        {detalle.sinNovedades
          ? "turno sin novedades"
          : `${detalle.lineas} línea(s)`}
      </p>

      {/* ── El estado de la confirmación ──────────────────────────── */}
      <section
        className={`mb-5 rounded-2xl border px-5 py-4 ${
          detalle.confirmado
            ? "border-emerald-200 bg-emerald-50"
            : "border-red-300 bg-red-50"
        }`}
      >
        <p className="text-[14px] font-semibold">
          {detalle.confirmado
            ? `Confirmado${
                detalle.confirmadoEn
                  ? ` a las ${hora(detalle.confirmadoEn)}`
                  : ""
              }`
            : "Sin confirmar"}
        </p>
        {!detalle.confirmado && detalle.zonasPorConfirmar.length > 0 && (
          <p className="mt-1 text-[13px]">
            Falta que lo reciba alguien de:{" "}
            {detalle.zonasPorConfirmar
              .map(
                (f) =>
                  detalle.zonas.find((z) => z.floorId === f)?.nombre ??
                  "Del centro",
              )
              .join(", ")}
            .
          </p>
        )}
        {detalle.acuses.length === 0 ? (
          <p className="mt-1 text-[13px] text-slate-600">
            Nadie lo ha confirmado todavía en la tablet de la sala.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-[13px]">
            {detalle.acuses.map((a, i) => (
              <li key={i}>
                <strong>{a.nombre}</strong> · {a.rol} · lo firmó a las{" "}
                {hora(a.at)}
                {/* **Las dos horas.** Si se separan, la confirmación se
                    encoló sin red y salió después — y eso es un dato del
                    wifi del edificio, no un error. */}
                {a.llegoEn && hora(a.llegoEn) !== hora(a.at)
                  ? ` · llegó a las ${hora(a.llegoEn)}`
                  : ""}
                {a.alcanceTotal
                  ? " · todo el centro"
                  : a.zonas.length > 0
                    ? ` · ${a.zonas.join(", ")}`
                    : ""}
                {a.tablet ? ` · ${a.tablet}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Lo que llegó después ──────────────────────────────────── */}
      {detalle.tardios.length > 0 && <Tardios tardios={detalle.tardios} />}

      {detalle.ilegible ? (
        <p className="rounded-2xl border-2 border-red-300 bg-red-50 px-5 py-4 text-[13.5px] text-red-800">
          <strong>Este parte no se puede leer.</strong> La fila está y el
          contenido no se ha podido descifrar. No se esconde a propósito:
          esto es lo que alguien tiene que mirar. Avisa a Mi Piace.
        </p>
      ) : detalle.parte == null ? (
        <p className="text-[13.5px] text-slate-500">No hay contenido.</p>
      ) : (
        <Parte parte={detalle.parte} />
      )}

      <Link
        to="/admin/residencia/relevos"
        className="mt-6 inline-block text-[13px] text-mipiace-coral underline"
      >
        Volver a los relevos
      </Link>
    </AdminShell>
  );
}

function Tardios({ tardios }: { tardios: AnadidoTardio[] }) {
  return (
    <section className="mb-5 rounded-2xl border-2 border-amber-300 bg-amber-50 px-5 py-4">
      <h2 className="text-[14px] font-semibold text-amber-900">
        Llegó después del relevo
      </h2>
      <p className="mt-0.5 text-[13px] text-amber-800">
        Esto no estaba en el parte cuando se congeló. El parte{" "}
        <strong>no se reescribe</strong>: es la evidencia de lo que se supo.
      </p>
      <ul className="mt-2 space-y-1 text-[13.5px]">
        {tardios.map((t) => (
          <li key={t.id}>
            <span className="text-slate-500">
              {NOMBRE_DEL_TARDIO[t.kind] ?? t.kind}
            </span>{" "}
            · pasó a las {hora(t.ocurrioEn)} ·{" "}
            {t.resumen ?? "(no se puede leer)"}{" "}
            <strong>llegó a las {hora(t.llegoEn)}</strong>
            {t.incidentId && (
              <>
                {" · "}
                <Link
                  to={`/admin/residencia/incidencias/${t.incidentId}`}
                  className="underline"
                >
                  abrir la incidencia
                </Link>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Parte({ parte }: { parte: ParteDeRelevo }) {
  if (parte.sinNovedades) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center">
        <p className="text-[16px] font-semibold">Turno sin novedades</p>
        <p className="mx-auto mt-2 max-w-md text-[13.5px] text-slate-500">
          No hubo incidencias, ni constantes fuera de rango, ni nada del plan
          sin hacer. Se confirma igual: el denominador cuenta tanto como lo
          que pasa.
        </p>
      </section>
    );
  }
  return (
    <>
      {parte.zonas.map((zona) => (
        <section key={zona.floorId ?? "centro"} className="mb-5">
          <h2 className="mb-2 border-b border-slate-300 pb-1 text-[15px] font-semibold">
            {zona.nombre}{" "}
            <span className="font-normal text-slate-500">
              · {zona.lineas} línea(s)
            </span>
          </h2>
          {zona.residentes.map((r) => (
            <article key={r.clientId} className="mb-3">
              <h3 className="text-[13.5px] font-medium">
                {r.habitacion && (
                  <span className="text-slate-500 tabular-nums">
                    {r.habitacion}{" "}
                  </span>
                )}
                <Link
                  to={`/admin/residencia/residentes/${r.clientId}/registros`}
                  className="underline"
                >
                  {r.nombre}
                </Link>
              </h3>
              <ul className="mt-1 space-y-1">
                {r.lineas.map((l, i) => (
                  <Linea key={i} linea={l} />
                ))}
              </ul>
            </article>
          ))}
          {zona.sueltas.length > 0 && (
            <article className="mb-3">
              <h3 className="text-[13.5px] font-medium text-slate-500">
                Del centro, sin residente
              </h3>
              <ul className="mt-1 space-y-1">
                {zona.sueltas.map((l, i) => (
                  <Linea key={i} linea={l} />
                ))}
              </ul>
            </article>
          )}
        </section>
      ))}
    </>
  );
}

function Linea({ linea }: { linea: LineaDelParte }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[13.5px]">
      {linea.nivel && (
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${colorDelNivel(
            linea.nivel as never,
          )}`}
        >
          {linea.nivel}
        </span>
      )}
      <span className="shrink-0 w-10 text-slate-500 tabular-nums">
        {linea.hora ?? "—"}
      </span>
      <span className="shrink-0 text-slate-500">
        {NOMBRE_DE_LA_CLASE[linea.clase] ?? linea.clase}
      </span>
      {linea.incidentId ? (
        <Link
          to={`/admin/residencia/incidencias/${linea.incidentId}`}
          className="underline"
        >
          {linea.texto}
        </Link>
      ) : (
        <span>{linea.texto}</span>
      )}
      {linea.aviso && (
        <span className="text-slate-500">
          {linea.aviso.acusadoPor
            ? `· lo cogió ${linea.aviso.acusadoPor}${
                linea.aviso.acusadoEn ? ` a las ${linea.aviso.acusadoEn}` : ""
              }`
            : "· nadie lo acusó"}
        </span>
      )}
    </li>
  );
}
