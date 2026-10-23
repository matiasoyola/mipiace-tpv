// residencia-5 (decisión de producto 5, bloque C §1-2) · **EL PANEL DE
// DIRECCIÓN.**
//
// Hoy la dirección se entera de lo que hay abierto preguntando. Esto es
// **una pantalla** que lo contesta sin preguntar a nadie, y es la pantalla
// de inicio del panel en un centro de residencia.
//
// ── EL ORDEN ES EL DE LA URGENCIA, NO EL DEL MODELO ─────────────────
//
//   1. Qué hay abierto hoy — la métrica de éxito (bloque C §2).
//   2. Los relevos: el último y los no confirmados de la semana.
//   3. Qué toca hoy y qué está vencido.
//   4. El turno en curso, por planta.
//   5. Los indicadores del mes.
//
// ── ≤ 3 TOQUES Y ≤ 10 s A CUALQUIER DATO (bloque C §1) ──────────────
//
// Es el criterio de aceptación de la v1 y es lo que decide la forma: **una
// sola petición** trae el panel entero (ver `panel.ts` en la API para por
// qué una y no cinco), y **cada cifra es un enlace**. Desde aquí:
//
//   · una cifra de incidencias → el libro filtrado (1 toque) → la
//     incidencia (2) → el residente (3);
//   · «3 zonas por confirmar» → el parte (1) → el residente (2);
//   · una obligación vencida → sus ocurrencias (1) → la evidencia (2).
//
// Ninguna cifra es un número muerto. Una cifra que no se puede abrir es
// una cifra que obliga a preguntar, que es justo lo que este panel existe
// para quitar.

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import { CenteredLoader, FieldError } from "../../ui.js";
import {
  colorDeLaConsecuencia,
  dia,
  hora,
  umbralEnPalabras,
  valorEnPalabras,
  type Panel,
} from "./relevo-lib.js";
import { colorDelNivel } from "./incidencias-lib.js";

export function PanelPage() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Puesto cuando el servidor dice que esto es de dirección. No es un
   *  error que haya que arreglar: es la respuesta correcta para un
   *  encargado sin rol directivo, y lo que se pinta es la frase. */
  const [noEsTuyo, setNoEsTuyo] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    try {
      setPanel(await api<Panel>("/residencia/panel"));
      setError(null);
      setNoEsTuyo(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === "PANEL_ES_DE_DIRECCION") {
        setNoEsTuyo(err.message);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (noEsTuyo) {
    return (
      <AdminShell title="Panel de dirección">
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-7 text-center">
          <p className="text-[14px] text-slate-600">{noEsTuyo}</p>
          <p className="mt-3 text-[13px] text-slate-500">
            Lo que sí puedes abrir está en la barra de la izquierda.
          </p>
        </div>
      </AdminShell>
    );
  }

  if (!panel) {
    return error ? (
      <AdminShell title="Panel de dirección">
        <FieldError message={error} />
      </AdminShell>
    ) : (
      <CenteredLoader label="Cargando el panel…" />
    );
  }

  const { abierto, relevos, obligaciones, turno, indicadores } = panel;
  const porArreglar = panel.porArreglar ?? {
    pinesPorRenovar: [],
    residentesSinPlan: [],
  };
  const cosasPorArreglar =
    porArreglar.pinesPorRenovar.length + porArreglar.residentesSinPlan.length;
  const conDato = indicadores.filter((i) => i.valor != null);
  const fuera = conDato.filter((i) => i.dentro === false);

  return (
    <AdminShell title="Panel de dirección">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        Lo que hay abierto hoy, el último relevo, lo que toca y los
        indicadores del mes. Cada cifra se abre.
      </p>

      {error && <FieldError message={error} />}

      {/* ══ 1 · QUÉ HAY ABIERTO HOY ══════════════════════════════ */}
      <section className="mb-7">
        <h2 className="mb-2 text-[16px] font-semibold text-mipiace-ink">
          Qué hay abierto hoy
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {/* **N4 y N3 primero.** El orden no es el del enum: es el de
              quién puede acabar en un hospital esta noche. */}
          {abierto.porNivel
            .filter((n) => n.nivel !== "N0")
            .map((n) => (
              <Link
                key={n.nivel}
                to={`/admin/residencia/incidencias?abiertas=1&nivel=${n.nivel}`}
                className={`rounded-2xl border px-4 py-3 ${
                  n.cuantas > 0 && (n.nivel === "N4" || n.nivel === "N3")
                    ? "border-red-300 bg-red-50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <span
                  className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${colorDelNivel(
                    n.nivel as never,
                  )}`}
                >
                  {n.nivel}
                </span>
                <p className="mt-1 text-[26px] font-semibold tabular-nums leading-none">
                  {n.cuantas}
                </p>
                <p className="text-[12px] text-slate-500">abiertas</p>
              </Link>
            ))}
          <Link
            to="/admin/residencia/incidencias?abiertas=1"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
          >
            <p className="text-[12px] text-slate-500">Avisos sin acuse</p>
            <p className="mt-1 text-[26px] font-semibold tabular-nums leading-none">
              {abierto.avisosSinAcuse}
            </p>
          </Link>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Link
            to="/admin/residencia/incidencias?abiertas=1&sujeto=RESIDENT"
            className={`rounded-2xl border px-4 py-3 text-[13.5px] ${
              abierto.sinConstanciaDeFamilia > 0
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            <strong className="tabular-nums">
              {abierto.sinConstanciaDeFamilia}
            </strong>{" "}
            incidencia(s) de residente <strong>sin constancia de familia</strong>
            {abierto.sinConstanciaDeFamilia > 0
              ? " — no se pueden cerrar hasta decidir si se comunica o no."
              : "."}
          </Link>
          <Link
            to="/admin/residencia/incidencias?abiertas=1"
            className={`rounded-2xl border px-4 py-3 text-[13.5px] ${
              abierto.esperandoCierreDeOtro > 0
                ? "border-red-300 bg-red-50 text-red-800"
                : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            <strong className="tabular-nums">
              {abierto.esperandoCierreDeOtro}
            </strong>{" "}
            N3-N4 <strong>esperando que las cierre otra persona</strong> (D-28).
          </Link>
        </div>
      </section>

      {/* ══ 2 · LOS RELEVOS ══════════════════════════════════════ */}
      <section className="mb-7">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-[16px] font-semibold text-mipiace-ink">Relevos</h2>
          <Link
            to="/admin/residencia/relevos"
            className="text-[13px] text-mipiace-coral underline"
          >
            Ver todos
          </Link>
        </div>
        {relevos.ultimo == null ? (
          <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13.5px] text-slate-500">
            Todavía no hay ningún parte de relevo. Se genera solo en cuanto
            cierre un turno.
          </p>
        ) : (
          <Link
            to={`/admin/residencia/relevos/${relevos.ultimo.id}`}
            className={`block rounded-2xl border px-5 py-4 ${
              relevos.ultimo.confirmado
                ? "border-emerald-200 bg-emerald-50"
                : "border-red-300 bg-red-50"
            }`}
          >
            <p className="text-[14.5px] font-semibold">
              Relevo de {relevos.ultimo.turno.toLowerCase()} ·{" "}
              {dia(relevos.ultimo.careDay)}
            </p>
            <p className="mt-0.5 text-[13px] text-slate-600">
              Congelado a las {hora(relevos.ultimo.congeladoEn)} ·{" "}
              {relevos.ultimo.sinNovedades
                ? "turno sin novedades"
                : `${relevos.ultimo.lineas} línea(s)`}{" "}
              ·{" "}
              {relevos.ultimo.confirmado ? (
                <strong>confirmado</strong>
              ) : (
                <strong>
                  sin confirmar
                  {relevos.ultimo.zonasPorConfirmar > 0
                    ? ` · ${relevos.ultimo.zonasPorConfirmar} zona(s) sin recibir`
                    : ""}
                </strong>
              )}
            </p>
            {relevos.ultimo.confirmadoPor.length > 0 && (
              <p className="mt-1 text-[13px] text-slate-500">
                Lo recibieron:{" "}
                {relevos.ultimo.confirmadoPor
                  .map(
                    (c) =>
                      `${c.nombre} (${c.rol}, ${hora(c.at)}${
                        c.alcanceTotal ? ", todo el centro" : ""
                      })`,
                  )
                  .join(" · ")}
              </p>
            )}
          </Link>
        )}
        {relevos.sinConfirmar.length > 0 && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-[13.5px] font-semibold text-amber-900">
              {relevos.sinConfirmar.length} relevo(s) de la semana sin confirmar
            </p>
            <ul className="mt-1 space-y-1 text-[13px] text-amber-900">
              {relevos.sinConfirmar.slice(0, 8).map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/admin/residencia/relevos/${r.id}`}
                    className="underline"
                  >
                    {dia(r.careDay)} · {r.turno.toLowerCase()} · {r.lineas}{" "}
                    línea(s)
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ══ 3 · QUÉ TOCA Y QUÉ ESTÁ VENCIDO ══════════════════════ */}
      <section className="mb-7">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-[16px] font-semibold text-mipiace-ink">
            Obligaciones
          </h2>
          <Link
            to="/admin/residencia/obligaciones"
            className="text-[13px] text-mipiace-coral underline"
          >
            Ver todas
          </Link>
        </div>
        {obligaciones.vencidas.length > 0 && (
          <div className="mb-3 rounded-2xl border-2 border-red-300 bg-red-50 px-5 py-4">
            <p className="text-[14px] font-semibold text-red-800">
              {obligaciones.vencidas.length} vencida(s)
            </p>
            <ul className="mt-2 space-y-1.5">
              {obligaciones.vencidas.slice(0, 10).map((o) => (
                <li key={o.id} className="text-[13.5px] text-red-900">
                  <span
                    className={`mr-2 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${colorDeLaConsecuencia(
                      o.consequence,
                    )}`}
                  >
                    {o.consequence}
                  </span>
                  <Link
                    to={`/admin/residencia/obligaciones?duty=${o.dutyId}`}
                    className="underline"
                  >
                    {o.nombre}
                  </Link>{" "}
                  — tocaba el {dia(o.dueOn)} ({Math.abs(o.diasRestantes)} día(s)
                  de retraso) · {o.responsable}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
            <p className="text-[13.5px] font-semibold">Hoy</p>
            {obligaciones.hoy.length === 0 ? (
              <p className="mt-1 text-[13px] text-slate-500">
                Nada pendiente para hoy.
              </p>
            ) : (
              <ul className="mt-1 space-y-1 text-[13px]">
                {obligaciones.hoy.map((o) => (
                  <li key={o.id}>
                    <Link
                      to={`/admin/residencia/obligaciones?duty=${o.dutyId}`}
                      className="underline"
                    >
                      {o.nombre}
                    </Link>{" "}
                    <span className="text-slate-500">· {o.responsable}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
            <p className="text-[13.5px] font-semibold">
              Vence en los próximos 60 días
            </p>
            {obligaciones.proximas.length === 0 ? (
              <p className="mt-1 text-[13px] text-slate-500">Nada a la vista.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-[13px]">
                {obligaciones.proximas.slice(0, 8).map((o) => (
                  <li key={o.id}>
                    <Link
                      to={`/admin/residencia/obligaciones?duty=${o.dutyId}`}
                      className="underline"
                    >
                      {o.nombre}
                    </Link>{" "}
                    <span className="text-slate-500">
                      · {dia(o.dueOn)} ({o.diasRestantes} día(s))
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* ══ 4 · EL TURNO EN CURSO ════════════════════════════════ */}
      <section className="mb-7">
        <h2 className="mb-2 text-[16px] font-semibold text-mipiace-ink">
          El turno en curso
        </h2>
        {turno.turno == null ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
            Los turnos del centro no cubren esta hora: hay un hueco en el
            cuadrante. Lo que se registre ahora se guarda{" "}
            <strong>sin turno</strong> y sale en el relevo como aviso.
          </p>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
            <p className="text-[13.5px]">
              Turno de {turno.turno.name.toLowerCase()} ·{" "}
              {dia(turno.careDay)}
            </p>
            <ul className="mt-2 space-y-1.5">
              {turno.plantas.map((p) => (
                <li
                  key={p.floorId ?? "sin"}
                  className="flex items-center gap-3 text-[13.5px]"
                >
                  <span className="w-32 shrink-0 text-slate-600">{p.nombre}</span>
                  <span className="tabular-nums">
                    {p.hechas} de {p.tocan}
                  </span>
                  {/* La barra: lo hecho sobre lo que toca. Sin animación,
                      que es la regla de la casa para lo que se repinta. */}
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                    <span
                      className="block h-full bg-mipiace-coral"
                      style={{
                        width: `${
                          p.tocan === 0
                            ? 0
                            : Math.round((p.hechas / p.tocan) * 100)
                        }%`,
                      }}
                    />
                  </span>
                </li>
              ))}
              {turno.plantas.length === 0 && (
                <li className="text-[13px] text-slate-500">
                  Nada planificado para este turno.
                </li>
              )}
            </ul>
            <p className="mt-3 text-[13px] text-slate-600">
              De los turnos ya cerrados de hoy quedaron{" "}
              <strong className="tabular-nums">
                {turno.noHechoDeTurnosCerrados}
              </strong>{" "}
              cosa(s) sin registrar.{" "}
              <Link to="/admin/residencia/relevos" className="underline">
                Se ven en su parte.
              </Link>
            </p>
          </div>
        )}
      </section>

      {/* ══ 4b · residencia-6 · LO QUE HAY QUE ARREGLAR ══════════
          Va **detrás del turno y delante de los indicadores**, y no
          arriba: no es una urgencia de hoy —nadie está en el hospital por
          esto— pero sí algo que deja el centro a medio configurar, y lo
          arregla quien ve esta pantalla. Y **no se pinta cuando no hay
          nada**: una tarjeta vacía con un «0» enseña a no mirar la
          sección. */}
      {cosasPorArreglar > 0 && (
        <section className="mb-7">
          <h2 className="mb-2 text-[16px] font-semibold text-mipiace-ink">
            Lo que hay que arreglar
          </h2>
          <div className="space-y-3">
            {porArreglar.pinesPorRenovar.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
                <p className="text-[13.5px] font-medium text-amber-900">
                  {porArreglar.pinesPorRenovar.length === 1
                    ? "1 PIN por renovar"
                    : `${porArreglar.pinesPorRenovar.length} PIN por renovar`}
                </p>
                <p className="mt-1 text-[13px] text-amber-900">
                  Tienen PIN de 4 cifras y un rol que ve todo el centro, así
                  que <strong>ahora no entran</strong> en la puerta, en la
                  sala ni en el móvil de guardia. Ponles uno de 6.
                </p>
                <ul className="mt-2 space-y-1">
                  {porArreglar.pinesPorRenovar.map((p) => (
                    <li key={p.userId} className="text-[13.5px]">
                      <Link to="/admin/staff" className="underline">
                        {p.nombre}
                      </Link>
                      {p.roles.length > 0 && (
                        <span className="text-slate-600">
                          {" · "}
                          {p.roles.join(", ")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {porArreglar.residentesSinPlan.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
                <p className="text-[13.5px] font-medium text-amber-900">
                  {porArreglar.residentesSinPlan.length === 1
                    ? "1 residente sin plan de cuidados"
                    : `${porArreglar.residentesSinPlan.length} residentes sin plan de cuidados`}
                </p>
                <p className="mt-1 text-[13px] text-amber-900">
                  No les toca nada, así que{" "}
                  <strong>no aparecen en «lo que toca» de su puerta</strong> y
                  no cuentan en los indicadores. Hasta que tengan plan, lo
                  que se les haga no queda registrado.
                </p>
                <ul className="mt-2 space-y-1">
                  {porArreglar.residentesSinPlan.map((r) => (
                    <li key={r.clientId} className="text-[13.5px]">
                      <Link
                        to={`/admin/residencia/residentes/${r.clientId}/plan`}
                        className="underline"
                      >
                        {r.nombre}
                      </Link>
                      {r.habitacion && (
                        <span className="text-slate-600">
                          {" · habitación "}
                          {r.habitacion}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ══ 5 · LOS INDICADORES ══════════════════════════════════ */}
      <section>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-[16px] font-semibold text-mipiace-ink">
            Indicadores de {panel.mes}
          </h2>
          <Link
            to="/admin/residencia/indicadores"
            className="text-[13px] text-mipiace-coral underline"
          >
            Ver y ajustar umbrales
          </Link>
        </div>
        {fuera.length > 0 && (
          <p className="mb-2 text-[13px] text-red-700">
            {fuera.length} de {conDato.length} fuera de umbral.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {indicadores.map((i) => (
            <Link
              key={i.code}
              to="/admin/residencia/indicadores"
              className={`rounded-2xl border px-4 py-3 ${
                i.dentro === false
                  ? "border-red-300 bg-red-50"
                  : i.dentro === true
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-slate-200 bg-white"
              }`}
            >
              <p className="text-[12.5px] text-slate-600">{i.nombre}</p>
              <p className="mt-1 text-[22px] font-semibold tabular-nums leading-none">
                {valorEnPalabras(i)}
              </p>
              <p className="mt-1 text-[12px] text-slate-500">
                Objetivo {umbralEnPalabras(i)}
                {i.umbralDelCentro ? "" : " (de serie)"}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </AdminShell>
  );
}
